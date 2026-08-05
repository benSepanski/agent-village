import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { declareTopologyFile } from '../declare.js';
import type { JournalEvent } from '../events.js';
import { Journal } from '../journal.js';
import type { CheckResult, RejectionReason } from '../topology.js';

/**
 * The documented M2 fixture command (milestone verification, steps 2-5): run
 * the checker over every rejection fixture, the allow-all fixture, and the M1
 * valid fixture, through the same declaration path the runtime uses. Needs no
 * Docker daemon: rejection happens at declaration, before anything runs —
 * which is the milestone's point. Exits non-zero if any criterion fails.
 */

interface RejectionExpectation {
  criterion: string;
  fixture: string;
  reason: RejectionReason;
  volume?: string;
  environment?: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, '..', '..', 'fixtures');

const REJECTIONS: RejectionExpectation[] = [
  {
    criterion: 'AC-M2.1',
    fixture: 'm2/two-writers/two-writer-environments.json',
    reason: 'volume-has-multiple-writers',
    volume: 'ledger',
  },
  {
    criterion: 'AC-M2.1',
    fixture: 'm2/two-writers/two-writers-via-subtrees.json',
    reason: 'volume-has-multiple-writers',
    volume: 'ledger',
  },
  {
    criterion: 'AC-M2.1',
    fixture: 'm2/two-writers/second-writer-via-reader-mode.json',
    reason: 'volume-has-multiple-writers',
    volume: 'ledger',
  },
  {
    criterion: 'AC-M2.1',
    fixture: 'm2/role-mode-mismatch/reader-mount-read-write.json',
    reason: 'mount-role-mode-mismatch',
    volume: 'scratch',
    environment: 'searcher',
  },
  {
    criterion: 'AC-M2.1',
    fixture: 'm2/role-mode-mismatch/writer-mount-read-only.json',
    reason: 'mount-role-mode-mismatch',
    volume: 'scratch',
    environment: 'searcher',
  },
  {
    criterion: 'AC-M2.2',
    fixture: 'm2/mediated-read-write/writer-mount.json',
    reason: 'mediated-volume-mounted-read-write',
    volume: 'memory',
    environment: 'assistant',
  },
  {
    criterion: 'AC-M2.2',
    fixture: 'm2/mediated-read-write/reader-mount-read-write.json',
    reason: 'mediated-volume-mounted-read-write',
    volume: 'memory',
    environment: 'assistant',
  },
  {
    criterion: 'AC-M2.3',
    fixture: 'm2/journal-mount/into-agent-environment.json',
    reason: 'journal-mounted-into-agent-environment',
    environment: 'assistant',
  },
  {
    criterion: 'AC-M2.3',
    fixture: 'm2/journal-mount/alongside-agentless-reader.json',
    reason: 'journal-mounted-into-agent-environment',
    environment: 'assistant',
  },
  {
    criterion: 'AC-M2.4',
    fixture: 'm2/credential-volume/outside-credential-environment.json',
    reason: 'credential-volume-outside-credential-environment',
    volume: 'vault-keys',
    environment: 'assistant',
  },
  {
    criterion: 'AC-M2.4',
    fixture: 'm2/credential-volume/writer-outside-credential-environment.json',
    reason: 'credential-volume-outside-credential-environment',
    volume: 'vault-keys',
    environment: 'provisioner',
  },
  {
    criterion: 'AC-M2.4',
    fixture: 'm2/credential-environment/mounts-foreign-written-volume.json',
    reason: 'credential-environment-mounts-foreign-written-volume',
    volume: 'notes',
    environment: 'vault',
  },
  {
    criterion: 'AC-M2.4',
    fixture: 'm2/credential-environment/foreign-writer-different-subtree.json',
    reason: 'credential-environment-mounts-foreign-written-volume',
    volume: 'notes',
    environment: 'vault',
  },
  {
    criterion: 'AC-M2.5',
    fixture: 'm2/missing-subtree/writer-missing-subtree.json',
    reason: 'mount-missing-subtree',
    volume: 'scratch',
    environment: 'searcher',
  },
  {
    criterion: 'AC-M2.5',
    fixture: 'm2/missing-subtree/reader-null-subtree.json',
    reason: 'mount-missing-subtree',
    volume: 'scratch',
    environment: 'searcher',
  },
];

function main(): void {
  const runId = randomBytes(4).toString('hex');
  const runDir = join(tmpdir(), `agent-environment-m2-${runId}`);
  mkdirSync(runDir, { recursive: true });

  const failures: string[] = [];
  const check = (id: string, ok: boolean, detail: string) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
    if (!ok) failures.push(`${id} (${detail})`);
  };

  const declareFixture = (fixture: string): { result: CheckResult; journal: Journal } => {
    const name = basename(fixture, '.json');
    const journal = new Journal(join(runDir, `journal-${name}.jsonl`), {
      application_instance: `ai-${name}`,
      activation: `act-${name}`,
      flow: `flow-${name}`,
    });
    return { result: declareTopologyFile(journal, join(fixtures, fixture)), journal };
  };

  const journalEvents = (journal: Journal): (JournalEvent & Record<string, unknown>)[] =>
    readFileSync(journal.file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as JournalEvent & Record<string, unknown>);

  let rejectedJournalShown = false;
  for (const expected of REJECTIONS) {
    const { result, journal } = declareFixture(expected.fixture);
    const violation = result.accepted
      ? undefined
      : result.violations.find((v) => v.reason === expected.reason);
    const elementsOk =
      violation !== undefined &&
      (expected.volume === undefined || violation.volume === expected.volume) &&
      (expected.environment === undefined || violation.environment === expected.environment);
    check(
      expected.criterion,
      !result.accepted && elementsOk,
      result.accepted
        ? `${expected.fixture} was accepted, expected ${expected.reason}`
        : `${expected.fixture} rejected: ${violation?.reason ?? result.violations.map((v) => v.reason).join(',')}` +
            `; offending element volume=${violation?.volume ?? '-'} environment=${violation?.environment ?? '-'}; instance not started`,
    );

    const events = journalEvents(journal);
    const rejected = events.filter((e) => e.event === 'topology.rejected');
    const started = events.some((e) => e.event === 'instance.started');
    check(
      'AC-M2.7',
      rejected.some((e) => e.reason === expected.reason && typeof e.detail === 'string') &&
        !started,
      `${expected.fixture}: topology.rejected journaled with reason ${rejected[0]?.reason ?? 'MISSING'}, no instance.started event`,
    );
    if (!rejectedJournalShown && rejected[0]) {
      console.log(`     journal (${expected.fixture}): ${JSON.stringify(rejected[0])}`);
      rejectedJournalShown = true;
    }
  }

  const allowAll = declareFixture('m2/allow-all/unmediated-write-path.json');
  const finding = allowAll.result.accepted ? allowAll.result.findings[0] : undefined;
  check(
    'AC-M2.6',
    allowAll.result.accepted &&
      allowAll.result.findings.length === 1 &&
      finding?.finding === 'unmediated-write-path' &&
      finding.bridge === 'memory-write' &&
      finding.volume === 'memory',
    allowAll.result.accepted
      ? `allow-all fixture accepted; checker reports: ${finding?.detail ?? 'NO FINDING'}`
      : `allow-all fixture was rejected: ${allowAll.result.violations.map((v) => v.reason).join(',')}`,
  );
  const declaredEvent = journalEvents(allowAll.journal).find(
    (e) => e.event === 'topology.declared',
  );
  check(
    'AC-M2.6',
    Array.isArray(declaredEvent?.findings) &&
      (declaredEvent.findings as { finding: string }[]).some(
        (f) => f.finding === 'unmediated-write-path',
      ),
    `topology.declared carries the unmediated-write-path finding`,
  );

  const m1 = declareFixture('m1-topology.json');
  check(
    'M1-regression',
    m1.result.accepted && m1.result.findings.length === 0,
    m1.result.accepted
      ? 'the M1 valid fixture is still accepted with no findings (starting it needs Docker: pnpm fixture:m1)'
      : `the M1 fixture was rejected: ${m1.result.violations.map((v) => v.detail).join('; ')}`,
  );

  console.log(`\njournals: ${runDir}`);
  if (failures.length > 0) {
    console.error(`\nFAILED: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('\nAll M2 checker criteria verified against this run.');
}

main();
