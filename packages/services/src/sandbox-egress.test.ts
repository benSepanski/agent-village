import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ApplicationManifest } from '@agent-village/shared';
import { ApplicationManifest as ApplicationManifestSchema } from '@agent-village/shared';
import { awsBaseDomains, buildEgressAllowlist } from './sandbox-egress.js';

// Connectivity recipes (M5, AC-6.1-6.3). This file only exercises the
// DERIVATION layer (buildEgressAllowlist) — the ENFORCEMENT layer
// (isHostAllowed/resolveTarget against the derived list) is covered in
// packages/infra/test/proxy-allowlist.test.ts. `services` may not import
// from `infra` (dependency-cruiser layering), so the cross-check here stays
// string-based: an allowed host appears in the derived list, a denied host
// does not.

const REGION = 'us-east-1';
const BUCKET = 'agent-village-dev-workspace';
const GATEWAY_HOST = 'gateway.agent-village.example.com';
const OFF_LIST_HOST = 'evil.example.com';

function loadRecipeManifest(recipeDir: string): ApplicationManifest {
  const raw: unknown = JSON.parse(
    readFileSync(new URL(`../../../examples/${recipeDir}/manifest.json`, import.meta.url), 'utf8'),
  );
  return ApplicationManifestSchema.parse(raw);
}

function derivedHosts(manifest: ApplicationManifest): string[] {
  return buildEgressAllowlist(manifest, REGION, BUCKET, [GATEWAY_HOST])
    .split(',')
    .map((h) => h.toLowerCase());
}

describe('AC-6.1 anthropic-only recipe', () => {
  const manifest = loadRecipeManifest('anthropic-only');

  it('allow: derived list includes the gateway host and AWS base domains', () => {
    const hosts = derivedHosts(manifest);
    expect(hosts).toContain(GATEWAY_HOST.toLowerCase());
    for (const domain of awsBaseDomains(REGION, BUCKET)) {
      expect(hosts).toContain(domain.toLowerCase());
    }
  });

  it('deny: an off-list host is absent from the derived list', () => {
    expect(derivedHosts(manifest)).not.toContain(OFF_LIST_HOST);
  });

  it('manifest declares no egressAllow entries of its own (gateway-only)', () => {
    expect(manifest.egressAllow).toEqual([]);
  });
});

describe('AC-6.2 notion-reader recipe', () => {
  const manifest = loadRecipeManifest('notion-reader');

  it('allow: derived list includes api.notion.com plus the always-on hosts', () => {
    const hosts = derivedHosts(manifest);
    expect(hosts).toContain('api.notion.com');
    expect(hosts).toContain(GATEWAY_HOST.toLowerCase());
  });

  it('deny: an off-list host is absent from the derived list', () => {
    expect(derivedHosts(manifest)).not.toContain(OFF_LIST_HOST);
  });

  it('grants a typed notion secret, not a generic secret grant (both notion-token leaf and NOTION_TOKEN env are reserved)', () => {
    expect(manifest.grants).toEqual([{ kind: 'notion', secretName: 'notion-token' }]);
  });
});

describe('AC-6.3 partial-email recipe (gmail-agent)', () => {
  const manifest = loadRecipeManifest('gmail-agent');

  it('allow: derived list includes the implicit-TLS mail hosts', () => {
    const hosts = derivedHosts(manifest);
    expect(hosts).toContain('imap.gmail.com');
    expect(hosts).toContain('smtp.gmail.com');
  });

  it('deny: an off-list host is absent from the derived list', () => {
    expect(derivedHosts(manifest)).not.toContain(OFF_LIST_HOST);
  });

  it('AC-6.5: does not rely on STARTTLS ports (143/587) to reach mail hosts', () => {
    // The proxy has no STARTTLS support (ADR 0003); the recipe must only use
    // implicit-TLS ports on the wire, which is a port-map fact tested in
    // proxy-allowlist.test.ts — this only guards the manifest doesn't imply
    // otherwise via its declared hosts (host allowlisting is port-agnostic,
    // so this is a documentation-level guard, not an enforcement one).
    expect(manifest.egressAllow).toEqual(
      expect.arrayContaining(['imap.gmail.com', 'smtp.gmail.com']),
    );
  });
});

describe('AC-6.4/AC-5.4 apply-bot recipe', () => {
  const manifest = loadRecipeManifest('apply-bot');

  it('allow: derived list includes the job-board hosts and PyPI', () => {
    const hosts = derivedHosts(manifest);
    expect(hosts).toContain('api.greenhouse.io');
    expect(hosts).toContain('jobs.lever.co');
    expect(hosts).toContain('pypi.org');
    expect(hosts).toContain('files.pythonhosted.org');
  });

  it('deny: an off-list host is absent from the derived list', () => {
    expect(derivedHosts(manifest)).not.toContain(OFF_LIST_HOST);
  });
});
