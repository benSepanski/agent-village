# Egress-proxy sidecar image (ADR 0003). Runs as a second container in every
# sandbox Fargate task; its entrypoint installs iptables NAT rules in the shared
# task network namespace, then drops NET_ADMIN and runs the transparent proxy as
# an unprivileged, dedicated uid. Built for linux/arm64 to match the task.
FROM public.ecr.aws/docker/library/node:22-bookworm-slim

# iptables installs the transparent-redirect rules; util-linux provides setpriv
# for the capability drop + uid switch. procps aids debugging.
RUN apt-get update \
  && apt-get install -y --no-install-recommends iptables util-linux \
  && rm -rf /var/lib/apt/lists/*

# Dedicated uid whose traffic is RETURNed (not redirected) so the proxy's own
# upstream connections escape the NAT loop. Must match AV_PROXY_UID.
RUN useradd --uid 1337 --no-create-home --shell /usr/sbin/nologin av-proxy

COPY allowlist.mjs proxy.mjs /opt/proxy/
COPY entrypoint.sh /usr/local/bin/av-egress-proxy
RUN chmod +x /usr/local/bin/av-egress-proxy

# Starts as root (needs NET_ADMIN for iptables); entrypoint drops to av-proxy.
ENTRYPOINT ["/usr/local/bin/av-egress-proxy"]
