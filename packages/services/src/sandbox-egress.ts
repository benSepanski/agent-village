import type { ContainerOverride } from '@aws-sdk/client-ecs';
import type { ApplicationManifest } from '@agent-village/shared';

/** Container name of the egress-proxy sidecar (matches SandboxStack + image). */
export const EGRESS_PROXY_CONTAINER = 'egress-proxy';

/**
 * AWS base domains the proxy must always allow so the base-image entrypoint's
 * `aws s3 sync` (and the STS/logs it depends on) keeps working, regardless of
 * the manifest allowlist. Returned lowercase; matched case-insensitively.
 *
 * S3 is scoped to the workspace bucket's virtual-hosted hostnames ONLY. The
 * former `*.s3.<region>` / bare `s3.<region>` / global `s3.amazonaws.com`
 * wildcards matched EVERY bucket (and path-style `s3.amazonaws.com/<any>`),
 * giving a compromised app a secret/workspace exfiltration channel to any
 * attacker-owned bucket that bypassed the manifest allowlist — IAM scopes S3
 * *actions* to the agent's prefix but does nothing to stop an anonymous PUT to
 * a foreign bucket, so egress was the only containment and it was wide open.
 * `aws s3 sync` uses virtual-hosted addressing (the bucket is DNS-compatible
 * and the region is configured — the regional STS entry already depends on it),
 * so both the regional and global bucket hostnames suffice.
 */
export function awsBaseDomains(region: string, workspaceBucket: string): string[] {
  return [
    `${workspaceBucket}.s3.${region}.amazonaws.com`,
    `${workspaceBucket}.s3.amazonaws.com`,
    `sts.${region}.amazonaws.com`,
    `logs.${region}.amazonaws.com`,
  ];
}

/**
 * Full per-run allowlist delivered to the proxy: AWS base domains UNION
 * platform-injected hosts (e.g. the Anthropic metering gateway, ADR 0004)
 * UNION the manifest's egressAllow, de-duplicated (case-insensitively) and
 * comma-joined.
 */
export function buildEgressAllowlist(
  manifest: ApplicationManifest,
  region: string,
  workspaceBucket: string,
  extraHosts: string[] = [],
): string {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const domain of [
    ...awsBaseDomains(region, workspaceBucket),
    ...extraHosts,
    ...manifest.egressAllow,
  ]) {
    const key = domain.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(domain);
  }
  return ordered.join(',');
}

/** Per-run override for the egress-proxy container carrying the allowlist. */
export function buildProxyOverride(
  manifest: ApplicationManifest,
  region: string,
  workspaceBucket: string,
  extraHosts: string[] = [],
): ContainerOverride {
  return {
    name: EGRESS_PROXY_CONTAINER,
    environment: [
      {
        name: 'AV_EGRESS_ALLOW',
        value: buildEgressAllowlist(manifest, region, workspaceBucket, extraHosts),
      },
    ],
  };
}

// NOTE: the app container gets NO HTTP_PROXY/HTTPS_PROXY env. The sidecar is a
// transparent proxy (iptables REDIRECT + SNI/Host peek) with no HTTP CONNECT
// support, so pointing SDKs — notably the AWS CLI, which honours HTTPS_PROXY —
// at it would break `aws s3 sync`. The iptables redirect enforces egress on its
// own without any app cooperation (ADR 0003).
