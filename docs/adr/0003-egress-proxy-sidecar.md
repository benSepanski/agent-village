# ADR 0003: Egress proxy as a per-run Fargate sidecar

Date: 2026-07-02
Status: Accepted

## Context

[ADR 0002](0002-fargate-sandbox-runs.md) chose per-run Fargate tasks in a
NAT-less public-subnet VPC and named "an egress proxy" as the network
access-limiting layer, without committing to its shape. The natural reading —
an always-on egress **service** every task routes through — has two costs that
cut against the project's guarantees:

- **Idle cost.** An always-on proxy (Fargate service, NLB, or NAT) reintroduces
  a ~$0-idle violation. ADR 0002's whole compute story is "~$0 when no run is
  active"; a standing proxy breaks that.
- **Deploy ordering / lifecycle.** A shared service is a stateful dependency the
  launcher must health-check and the deploy must sequence, and it becomes a
  single choke point across all agents' runs.

The enforcement requirement is unchanged: allowlist egress **by hostname**
(SNI / HTTP Host), because CIDR/security-group rules cannot track CDN-fronted
APIs, and the allowlist is **per run** (the manifest's `egressAllow`).

## Decision

Run the egress proxy as a **second container in each sandbox Fargate task** — a
per-run sidecar named `egress-proxy`, not an always-on service.

- **Same $0-idle, NAT-less posture.** The sidecar exists only while a run's task
  is running; there is no standing service, load balancer, or NAT. This
  supersedes the "egress proxy service" shape implied by ADR 0002 for the
  compute layer (ADR 0002's state/compute decisions otherwise stand).
- **Intra-task iptables transparent redirect.** Fargate containers in one task
  share a network namespace. The proxy image
  ([`packages/infra/proxy-image/`](../../packages/infra/proxy-image/)) starts
  with `NET_ADMIN`, and its entrypoint installs NAT rules that `RETURN`
  (bypass) loopback, DNS (udp/tcp 53), and traffic owned by the proxy's own uid,
  then `REDIRECT` all other outbound TCP to the proxy's transparent listen port.
  It then drops `NET_ADMIN` and execs the Node proxy as a dedicated
  unprivileged uid. Because the redirect lives in the shared namespace, the app
  container's egress is forced through the proxy **regardless of app
  cooperation**. Non-DNS **UDP** is dropped outright in the filter table
  (REDIRECTing UDP to a TCP proxy is meaningless): this closes QUIC / HTTP3 on
  UDP/443 and any other UDP path that would otherwise skip the allowlist, forcing
  clients onto TCP TLS, which is enforced. Loopback and DNS (UDP/53) stay open.
- **Hostname allowlist via SNI / Host peek.** The Node proxy peeks the first
  bytes of each redirected connection: a TLS ClientHello yields the SNI server
  name, a plaintext HTTP request yields the Host header. The original
  destination port is recovered by **port-mapped REDIRECT** (Phase 3 step 04):
  each supported port gets its own local listener (80→15080, 443→15443,
  465→15465, 993→15993) and the accepting listener identifies the port, so
  allowed hosts are dialed on their real ports (IMAPS 993, SMTPS 465);
  plaintext HTTP stays port-80-only, all other TCP ports are denied by a
  catch-all listener, and STARTTLS (587/143, server-speaks-first) is
  unsupported — see the design note atop `proxy.mjs`.
  The hostname is matched — exact or leading-`*.` wildcard,
  case-insensitive, mirroring `EgressDomain` in
  [`manifest.ts`](../../packages/shared/src/schemas/manifest.ts) — against the
  allowlist. Allowed connections are spliced bidirectionally; denied ones are
  closed with a `sandbox.egress.denied` structured log line. The pure matcher +
  SNI/Host parsers live in
  [`allowlist.mjs`](../../packages/infra/proxy-image/allowlist.mjs) and are
  unit-tested in isolation.
- **AWS base allowlist ∪ manifest.** The launcher
  ([`packages/services/src/sandbox-egress.ts`](../../packages/services/src/sandbox-egress.ts))
  delivers `AV_EGRESS_ALLOW` as a per-run container override: the AWS base
  domains the workspace-sync entrypoint needs (`s3.<region>.amazonaws.com`,
  `*.s3.<region>.amazonaws.com`, `s3.amazonaws.com`, `sts.<region>.amazonaws.com`,
  `logs.<region>.amazonaws.com`) **union** the run's `manifest.egressAllow`.
  Without the AWS base set, `aws s3 sync` in the base-image entrypoint would be
  blocked by the proxy.
- **Security group.** `allowAllOutbound` stays `true`: iptables is the real
  enforcement, and tightening the SG would only need re-widening for DNS + AWS +
  allowlisted domains. The SG is defense-in-depth only; its description is
  updated to say enforcement lives in the sidecar.
- **No `HTTP_PROXY`/`HTTPS_PROXY` on the app.** The proxy is _transparent_ (it
  peeks SNI/Host of a redirected origin-form stream) and does **not** implement
  HTTP `CONNECT`. Setting proxy env would point cooperating SDKs — notably the
  AWS CLI, which honours `HTTPS_PROXY` — at a proxy that speaks the wrong
  protocol, breaking `aws s3 sync`. The iptables redirect enforces egress with no
  app cooperation, so no proxy env is set. (If an explicit-proxy mode is ever
  wanted, the proxy must first learn to answer `CONNECT` with
  `200 Connection Established` and splice the _subsequent_ bytes.)
- **Image delivery.** A new ECR repo `${prefix}-egress-proxy` holds the ARM64
  sidecar image, resolved at `RunTask` time via the `:latest` tag exactly like
  the base image, so a post-deploy image push is fine and no deploy-ordering
  edge is introduced.

## Consequences

- **Enforcement is intra-task iptables, not the security group.** Network audit
  and per-run allowlisting live in the sidecar's structured logs
  (`sandbox.proxy.started`, `sandbox.egress.allowed`/`denied`), delivered by the
  same Fargate CloudWatch log agent as the app container — log delivery is
  unaffected by this change.
- **A base AWS allowlist is mandatory.** The workspace sync depends on S3/STS
  reachability; the base domains are always injected regardless of the manifest.
- **The app shares the task network namespace with the proxy**, so the proxy's
  uid separation is **load-bearing**: the `--uid-owner` RETURN rule is the only
  thing keeping the proxy's own upstream sockets from being redirected back into
  itself, and it also means the app cannot impersonate the proxy uid (it runs as
  a different user). An app that could run as the proxy uid could bypass the
  redirect — the image runs the app as a non-privileged, non-proxy user.
- **No new idle cost.** No NAT gateway, no standing service, no load balancer.
  The NAT-count-0 cost guard from ADR 0002 continues to hold; the sidecar adds
  only per-run task time.
- **Residual risk (unchanged from ADR 0002):** an agent that reads untrusted
  input and holds an outbound grant can be steered; the hostname allowlist caps
  the destinations, not the intent.

## Status

Accepted. Supersedes the "egress proxy service" shape implied by
[ADR 0002](0002-fargate-sandbox-runs.md) for the compute layer; ADR 0002's
compute/state decisions otherwise remain in force.
