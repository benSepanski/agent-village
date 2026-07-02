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

# NAT OUTPUT chain: everything not explicitly RETURNed is REDIRECTed to the
# transparent listen port. Order matters — exemptions come before the catch-all.
iptables -t nat -N AV_EGRESS
# The proxy's own traffic (opened as PROXY_UID) must go straight out.
iptables -t nat -A AV_EGRESS -m owner --uid-owner "$PROXY_UID" -j RETURN
# Loopback and DNS are never proxied.
iptables -t nat -A AV_EGRESS -o lo -j RETURN
iptables -t nat -A AV_EGRESS -p udp --dport 53 -j RETURN
iptables -t nat -A AV_EGRESS -p tcp --dport 53 -j RETURN
# Everything else: transparent-redirect TCP to the proxy.
iptables -t nat -A AV_EGRESS -p tcp -j REDIRECT --to-ports "$PROXY_PORT"
iptables -t nat -A OUTPUT -p tcp -j AV_EGRESS

# Non-DNS UDP has no transparent-proxy equivalent (REDIRECTing UDP to a TCP
# proxy is meaningless), so drop it outright in the filter table. This closes
# QUIC / HTTP3 (UDP/443) and any other UDP egress that would otherwise skip the
# allowlist entirely; clients fall back to TCP TLS, which IS enforced. Loopback
# and DNS (UDP/53) stay open so name resolution keeps working.
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -p udp --dport 53 -j ACCEPT
iptables -A OUTPUT -p udp -j DROP
echo "egress-proxy: iptables rules installed (TCP redirect ->:${PROXY_PORT}, non-DNS UDP dropped)" >&2

# Drop NET_ADMIN before running untrusted-adjacent Node: setpriv runs the proxy
# as PROXY_UID with an empty capability set. The uid must match --uid-owner.
exec setpriv --reuid "$PROXY_UID" --regid "$PROXY_UID" --clear-groups \
  --inh-caps=-all --bounding-set=-all \
  node /opt/proxy/proxy.mjs
