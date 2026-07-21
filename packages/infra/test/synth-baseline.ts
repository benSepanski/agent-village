import { readFileSync } from 'node:fs';
import type { App } from 'aws-cdk-lib';

/**
 * Matches 64-hex-char asset hashes (esbuild bundle hashes, `asset.<hash>`
 * directory names, `<hash>.zip`/`.json` S3 keys). This is the only source
 * of cross-run/cross-machine nondeterminism in a credential-free synth —
 * see M5 spec Task 1. Normalizing it (rather than the containing field
 * name) also neutralizes `BucketDeployment` `SourceObjectKeys`/`S3Key`,
 * which embed the same hash.
 */
const ASSET_HASH_RE = /[a-f0-9]{64}/g;

/** Redacts non-deterministic asset hashes from a synthesized CloudFormation
 * template so two synths of logically-identical infra compare equal. */
export function normalizeTemplate(template: unknown): unknown {
  return JSON.parse(JSON.stringify(template).replace(ASSET_HASH_RE, '<asset-hash>')) as unknown;
}

/**
 * Synthesizes every stack `buildApp` added to `app` and returns
 * `{ [stackName]: normalizedTemplate }` — the same shape as the committed
 * baseline fixtures (test/__fixtures__/synth-baseline/{dev,prod}.json).
 */
export function synthNormalizedTemplates(app: App): Record<string, unknown> {
  const assembly = app.synth();
  const templates: Record<string, unknown> = {};
  for (const stack of assembly.stacks) {
    templates[stack.stackName] = normalizeTemplate(stack.template);
  }
  return templates;
}

/** Loads a committed pre-refactor baseline (see M5 spec Task 1: captured on
 * the pre-refactor tree — commit a73a924, before bin/app.ts's inline stack
 * wiring moved into buildApp — by constructing the same 7 stacks + cdk-nag
 * suppressions a73a924's bin/app.ts wired inline, then synthesizing
 * in-process via `new App().synth()` and normalizing exactly as
 * synthNormalizedTemplates does above, then committing the result verbatim). */
export function loadBaseline(name: 'dev' | 'prod'): Record<string, unknown> {
  const url = new URL(`./__fixtures__/synth-baseline/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;
}

/**
 * The ONE known, intentional divergence from the pre-refactor (a73a924)
 * baseline: a73a924's bin/app.ts hardcoded *both* dev and prod ARN/resource-
 * name patterns into every IAM5 `appliesTo` list, regardless of which env
 * was being synthesized (so a dev synth's cdk-nag suppression metadata
 * carried inert prod-ARN entries matching nothing in that template, and vice
 * versa). `app-builder-suppressions.ts` intentionally parameterizes these by
 * `config.env`/`config.prefix`, so a single-env synth now only lists that
 * env's own ARNs. This changes cdk-nag suppression *annotation metadata*
 * only (`Metadata.cdk_nag.rules_to_suppress[].applies_to` in the
 * synthesized template) — cdk-nag still passes identically, and no deployed
 * resource, IAM statement, or non-metadata template field is affected.
 *
 * Strip the removed cross-env entries out of the loaded baseline before
 * comparing, so the snapshot test still fails on any *other* (unintended)
 * construct-tree drift while not re-asserting stale cross-env suppressions
 * that were always dead weight.
 */
const OTHER_ENV: Record<'dev' | 'prod', 'dev' | 'prod'> = { dev: 'prod', prod: 'dev' };

interface CdkNagRule {
  applies_to?: string[];
  [key: string]: unknown;
}

export function stripKnownCrossEnvAppliesTo(
  templates: Record<string, unknown>,
  env: 'dev' | 'prod',
): Record<string, unknown> {
  const other = OTHER_ENV[env];
  const clone = JSON.parse(JSON.stringify(templates)) as Record<
    string,
    { Metadata?: { cdk_nag?: { rules_to_suppress?: CdkNagRule[] } } }
  >;
  for (const stack of Object.values(clone)) {
    const rules = stack.Metadata?.cdk_nag?.rules_to_suppress;
    if (!rules) continue;
    for (const rule of rules) {
      if (!rule.applies_to) continue;
      rule.applies_to = rule.applies_to.filter(
        (entry) =>
          !entry.includes(`agent-village/${other}/`) && !entry.includes(`agent-village-${other}-`),
      );
    }
  }
  return clone;
}
