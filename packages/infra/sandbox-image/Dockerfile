# Sandbox base image. Applications build FROM this image; the entrypoint wraps
# every run with S3 workspace sync (see entrypoint.sh) so applications just
# read and write files under /workspace.
FROM public.ecr.aws/docker/library/node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git unzip \
  && rm -rf /var/lib/apt/lists/* \
  && curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o /tmp/awscliv2.zip \
  && unzip -q /tmp/awscliv2.zip -d /tmp \
  && /tmp/aws/install \
  && rm -rf /tmp/aws /tmp/awscliv2.zip

COPY entrypoint.sh /usr/local/bin/av-sandbox-entrypoint
RUN chmod +x /usr/local/bin/av-sandbox-entrypoint

# Run applications as a fixed non-root uid that is NOT the egress-proxy uid
# (1337). The proxy sidecar shares this task's network namespace and exempts its
# own uid from the iptables egress redirect (ADR 0003); a root app could
# `setuid(1337)` and send traffic straight out, bypassing the allowlist and the
# metering gateway. A non-root app has no CAP_SETUID, so it cannot assume 1337.
# The task definition also pins `user` so a derived image cannot revert this.
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin sandbox \
  && mkdir -p /workspace \
  && chown -R 10001:10001 /workspace

WORKDIR /workspace
USER 10001
ENTRYPOINT ["/usr/local/bin/av-sandbox-entrypoint"]
# Applications override CMD (or the manifest's `command` overrides it per run).
CMD ["node", "--version"]
