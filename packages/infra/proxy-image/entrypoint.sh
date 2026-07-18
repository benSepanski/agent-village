#!/usr/bin/env bash
# Egress-proxy sidecar entrypoint. Fargate tasks share one network namespace
# across containers, so the iptables NAT rules installed here transparently
# redirect the *app* container's outbound TCP into this proxy — enforcement
# does not depend on the app cooperating. After installing rules we drop
# NET_ADMIN and exec the Node proxy as an unprivileged, dedicated uid so the
# proxy's own upstream connections are exempted (see the --uid-owner RETURN).
set -euo pipefail

# Kept in lockstep with proxy.mjs and the launcher; see docs/adr/0003.
PROXY_PORT="${AV_PROXY_PORT:-15001}"
PROXY_UID="${AV_PROXY_UID:-1337}"

# The task's DNS resolvers (from /etc/resolv.conf). DNS is exempted from the
# redirect for name resolution ONLY to these hosts — matching `--dport 53` for
# ANY destination would let the app open a raw TCP/UDP tunnel to port 53 on an
# arbitrary host, bypassing the hostname allowlist entirely.
RESOLVERS="$(awk '/^nameserver/ { print $2 }' /etc/resolv.conf 2>/dev/null || true)"
if [ -z "$RESOLVERS" ]; then
  echo "egress-proxy: WARNING no nameservers in /etc/resolv.conf; DNS will be blocked" >&2
fi

# NAT OUTPUT chain: everything not explicitly RETURNed is REDIRECTed to the
# transparent listen port. Order matters — exemptions come before the catch-all.
iptables -t nat -N AV_EGRESS
# The proxy's own traffic (opened as PROXY_UID) must go straight out.
iptables -t nat -A AV_EGRESS -m owner --uid-owner "$PROXY_UID" -j RETURN
# Loopback is never proxied.
iptables -t nat -A AV_EGRESS -o lo -j RETURN
# DNS to the task resolvers only (see RESOLVERS above).
for ns in $RESOLVERS; do
  iptables -t nat -A AV_EGRESS -p udp -d "$ns" --dport 53 -j RETURN
  iptables -t nat -A AV_EGRESS -p tcp -d "$ns" --dport 53 -j RETURN
done
# Port-mapped REDIRECT (see the design note atop proxy.mjs): each supported
# original destination port P gets its own local listener at 15000 + P, so the
# proxy can recover the original port without SO_ORIGINAL_DST. The port list
# is kept in lockstep with SUPPORTED_PORTS in allowlist.mjs (guarded by
# packages/infra/test/proxy-allowlist.test.ts).
for dport in 80 443 465 993; do
  iptables -t nat -A AV_EGRESS -p tcp --dport "$dport" -j REDIRECT --to-ports "$((15000 + dport))"
done
# Any other TCP port: redirect to the catch-all listener, which denies (the
# original destination is unrecoverable there). STARTTLS ports (587/143) are
# intentionally unmapped — server-speaks-first protocols cannot be classified
# by a client-first peek; apps use implicit TLS (465/993) instead.
iptables -t nat -A AV_EGRESS -p tcp -j REDIRECT --to-ports "$PROXY_PORT"
iptables -t nat -A OUTPUT -p tcp -j AV_EGRESS

# Non-DNS UDP has no transparent-proxy equivalent (REDIRECTing UDP to a TCP
# proxy is meaningless), so drop it outright in the filter table. This closes
# QUIC / HTTP3 (UDP/443) and any other UDP egress that would otherwise skip the
# allowlist entirely; clients fall back to TCP TLS, which IS enforced. Loopback
# and DNS (UDP/53) stay open so name resolution keeps working.
iptables -A OUTPUT -o lo -j ACCEPT
# Only UDP DNS to the task resolvers is allowed; all other UDP is dropped.
for ns in $RESOLVERS; do
  iptables -A OUTPUT -p udp -d "$ns" --dport 53 -j ACCEPT
done
iptables -A OUTPUT -p udp -j DROP
echo "egress-proxy: iptables rules installed (port-mapped TCP redirect 80/443/465/993 ->15000+P, catch-all ->:${PROXY_PORT}, DNS pinned to task resolvers, non-DNS UDP dropped)" >&2

# IPv6 egress: fail CLOSED. The IPv4 rules above are the live enforcement path
# (the sandbox VPC is IPv4-only today), but they do not touch IPv6 at all — if a
# dual-stack CIDR were ever added, every IPv6 destination would be reachable
# unfiltered, bypassing the hostname allowlist entirely. Default the IPv6 OUTPUT
# chain to DROP so IPv6 egress can never skip the proxy, permitting only the
# loopback + DNS the proxy itself needs (mirroring the IPv4 `-o lo` / resolver
# exemptions). Guarded on ip6tables being usable: if the binary or ip6_tables
# module is unavailable there is no IPv6 stack to leak through, so skipping the
# rules is still closed and must not abort container startup. The `if` condition
# is exempt from `set -e`, so an absent ip6tables falls through to the warning.
if command -v ip6tables >/dev/null 2>&1 && ip6tables -L OUTPUT >/dev/null 2>&1; then
  # Loopback is never blocked (mirrors the IPv4 `-o lo -j ACCEPT`).
  ip6tables -A OUTPUT -o lo -j ACCEPT
  # DNS to the task resolvers only, and only those that are IPv6 literals — the
  # RESOLVERS list is shared with the IPv4 rules and is IPv4-only today, so this
  # loop normally adds nothing (the `*:*` glob matches IPv6 addresses only).
  for ns in $RESOLVERS; do
    case "$ns" in
      *:*)
        ip6tables -A OUTPUT -p udp -d "$ns" --dport 53 -j ACCEPT
        ip6tables -A OUTPUT -p tcp -d "$ns" --dport 53 -j ACCEPT
        ;;
    esac
  done
  # Everything else drops. Set as the chain policy (not a trailing rule) so it
  # also covers anything that races rule installation. `set -e` still applies in
  # the body: a partial failure aborts before readiness, which is fail-closed.
  ip6tables -P OUTPUT DROP
  echo "egress-proxy: ip6tables OUTPUT default DROP (IPv6 egress fails closed; loopback + IPv6 DNS resolvers exempted)" >&2
else
  echo "egress-proxy: WARNING ip6tables unavailable; skipping IPv6 rules (no IPv6 egress path expected)" >&2
fi

# Readiness marker for the app container's dependsOn:HEALTHY. Written only after
# every egress rule above is installed (set -e aborts on any failure), so the
# app cannot start — and therefore cannot egress — before enforcement is up.
: > /tmp/av-egress-ready

# Drop NET_ADMIN before running untrusted-adjacent Node: setpriv runs the proxy
# as PROXY_UID with an empty capability set. The uid must match --uid-owner.
exec setpriv --reuid "$PROXY_UID" --regid "$PROXY_UID" --clear-groups \
  --inh-caps=-all --bounding-set=-all \
  node /opt/proxy/proxy.mjs
