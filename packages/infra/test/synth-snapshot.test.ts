import { App } from 'aws-cdk-lib';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app-builder.js';
import { devConfig } from '../config/dev.js';
import { prodConfig } from '../config/prod.js';
import {
  loadBaseline,
  stripKnownCrossEnvAppliesTo,
  synthNormalizedTemplates,
} from './synth-baseline.js';

// Zero-drift guard for the buildApp extraction (INFRA-CONFIG): the baseline
// fixtures were captured from the pre-refactor tree (commit a73a924,
// bin/app.ts inlined the whole app, before it moved into buildApp). If this
// test still passes, pulling the stack wiring into a function changed
// nothing about the construct tree — logical IDs, resource properties, and
// cdk-nag suppressions are unchanged, modulo the asset-hash normalization
// (see synthNormalizedTemplates) and ONE documented, intentional diff: the
// refactor parameterizes IAM5 `appliesTo` suppression lists by env/prefix
// instead of a73a924's hardcoded both-envs lists, so a single-env synth no
// longer carries the other env's (always-inert) ARN entries in its cdk-nag
// suppression metadata. stripKnownCrossEnvAppliesTo removes exactly that
// known-stale metadata from the loaded baseline before comparing — see its
// doc comment for the full justification. Every other field, including all
// deployed resource properties and IAM statements, is compared byte-for-
// byte. Synthesizing all 7 stacks (esbuild-bundling every Lambda handler)
// takes well over vitest's 5s default per environment.
const SYNTH_TIMEOUT_MS = 60_000;

describe('synth-snapshot zero-drift', () => {
  it(
    'dev matches the pre-refactor baseline',
    () => {
      const app = new App();
      buildApp(app, devConfig);
      expect(synthNormalizedTemplates(app)).toEqual(
        stripKnownCrossEnvAppliesTo(loadBaseline('dev'), 'dev'),
      );
    },
    SYNTH_TIMEOUT_MS,
  );

  it(
    'prod matches the pre-refactor baseline',
    () => {
      const app = new App();
      buildApp(app, prodConfig);
      expect(synthNormalizedTemplates(app)).toEqual(
        stripKnownCrossEnvAppliesTo(loadBaseline('prod'), 'prod'),
      );
    },
    SYNTH_TIMEOUT_MS,
  );
});
