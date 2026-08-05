import { readFileSync } from 'node:fs';

import { digestOf, type Journal } from './journal.js';
import { checkTopology, type CheckResult, type Violation } from './topology.js';

/**
 * The single declaration path: check, then journal the outcome. An accepted
 * topology emits `topology.declared` carrying the checker's surfaced findings,
 * with principal `owner` — the declarer. A refused one emits one
 * `topology.rejected` per violated rule, with principal `runtime` — the
 * refuser — and the caller must not start anything (AC-M2.7).
 */
export function declareTopology(journal: Journal, raw: unknown): CheckResult {
  const result = checkTopology(raw);
  if (result.accepted) {
    journal.emit({
      event: 'topology.declared',
      principal: { kind: 'owner' },
      turn: null,
      topology_digest: digestOf(result.topology),
      application: result.topology.application,
      findings: result.findings,
    });
    return result;
  }
  journalRejection(journal, result.violations, digestOf(raw));
  return result;
}

export function declareTopologyFile(journal: Journal, path: string): CheckResult {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    const violations: Violation[] = [
      {
        reason: 'declaration-malformed',
        detail: `unreadable declaration at ${path}: ${String(cause)}`,
      },
    ];
    journalRejection(journal, violations, null);
    return { accepted: false, violations };
  }
  return declareTopology(journal, raw);
}

function journalRejection(
  journal: Journal,
  violations: Violation[],
  rawDigest: string | null,
): void {
  for (const violation of violations) {
    journal.emit({
      event: 'topology.rejected',
      principal: { kind: 'runtime' },
      turn: null,
      topology_digest: rawDigest,
      application: null,
      reason: violation.reason,
      detail: violation.detail,
      volume: violation.volume ?? null,
      environment: violation.environment ?? null,
      bridge: violation.bridge ?? null,
    });
  }
}
