import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Bridge } from '../bridge.js';
import { EVENT_NAMES, type JournalEvent } from '../events.js';
import { digestOf, Journal } from '../journal.js';
import {
  environmentLogs,
  removeEnvironment,
  startEnvironment,
  waitEnvironment,
} from '../runtime.js';
import { loadTopology, TopologyError } from '../topology.js';

/**
 * The documented M1 fixture command (milestone verification, step 2): declare
 * the skeleton topology, start the environment, let the probe run its sweep and
 * crossings, then check every M1 acceptance criterion against the journal and
 * the probe's report. Exits non-zero if any criterion fails.
 */

interface ProbeReport {
  sweep: { attempt: string; outcome: string; detail: string }[];
  mounts: string;
  bridge_dir: string[];
  journal_paths_reachable: string[];
  invocations: {
    declared_allowed: { ok: boolean; crossing: string };
    declared_denied: { ok: boolean; crossing: string; reason?: string };
    undeclared: { ok: boolean; crossing: string; reason?: string };
  };
}

const here = dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
  const topologyPath = process.argv[2] ?? resolve(here, '..', '..', 'fixtures', 'm1-topology.json');

  let topology;
  try {
    topology = loadTopology(topologyPath);
  } catch (err) {
    if (err instanceof TopologyError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const runId = randomBytes(4).toString('hex');
  const runDir = join(tmpdir(), `agent-environment-m1-${runId}`);
  const channelDir = join(runDir, 'channel');
  mkdirSync(channelDir, { recursive: true });

  const identity = {
    application_instance: `ai-${runId}`,
    activation: `act-${runId}`,
    flow: `flow-${runId}`,
  };
  const turn = 'turn-1';
  const journal = new Journal(join(runDir, 'journal.jsonl'), identity);

  journal.emit({
    event: 'topology.declared',
    principal: { kind: 'runtime' },
    turn: null,
    topology_digest: digestOf(topology),
    application: topology.application,
  });

  const bridge = new Bridge(topology, journal, turn, identity);
  await bridge.listen(join(channelDir, 'bridge.sock'));

  // The environment gets only the code it runs — the probe and its harness
  // client — never the platform's own modules (AC-M1.5's search would rightly
  // flag a mounted journal.js, and the platform is not the environment's to read).
  const appDir = join(runDir, 'app');
  mkdirSync(join(appDir, 'probe'), { recursive: true });
  const dist = resolve(here, '..');
  copyFileSync(join(dist, 'probe', 'run-m1.js'), join(appDir, 'probe', 'run-m1.js'));
  copyFileSync(join(dist, 'harness-client.js'), join(appDir, 'harness-client.js'));

  const env = await startEnvironment({
    name: `ae-m1-${runId}`,
    channelDir,
    codeDir: appDir,
    entrypoint: 'probe/run-m1.js',
  });
  journal.emit({
    event: 'instance.started',
    principal: { kind: 'runtime' },
    turn: null,
    environment: topology.environment.name,
    container: env.container,
  });
  journal.emit({ event: 'activation.started', principal: { kind: 'runtime' }, turn: null });

  const exitCode = await waitEnvironment(env);
  const logs = await environmentLogs(env);
  await removeEnvironment(env);
  journal.emit({
    event: 'activation.ended',
    principal: { kind: 'runtime' },
    turn: null,
    outcome: exitCode === 0 ? 'completed' : 'failed',
  });
  await bridge.close();

  const report = JSON.parse(logs.trim().split('\n').at(-1) ?? '{}') as ProbeReport;
  writeFileSync(join(runDir, 'probe-report.json'), JSON.stringify(report, null, 2));

  const events = readFileSync(journal.file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as JournalEvent & Record<string, unknown>);

  const failures: string[] = [];
  const check = (id: string, ok: boolean, detail: string) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
    if (!ok) failures.push(id);
  };

  check(
    'AC-M1.1',
    exitCode === 0 && report.sweep.length >= 7 && report.sweep.every((a) => a.outcome === 'failed'),
    `probe exit ${exitCode}; ${report.sweep.length} network attempts, outcomes: ${report.sweep
      .map((a) => a.outcome)
      .join(',')}`,
  );

  const allowedId = report.invocations.declared_allowed.crossing;
  const allowedSeq = events.filter((e) => e.crossing === allowedId).map((e) => e.event);
  check(
    'AC-M1.2',
    report.invocations.declared_allowed.ok &&
      JSON.stringify(allowedSeq) ===
        JSON.stringify(['crossing.requested', 'crossing.decided', 'crossing.performed']) &&
      events.some(
        (e) =>
          e.crossing === allowedId &&
          e.event === 'crossing.decided' &&
          e.verdict === 'allow' &&
          e.decider === 'program',
      ),
    `crossing ${allowedId} events: ${allowedSeq.join(' -> ')}`,
  );

  const deniedId = report.invocations.declared_denied.crossing;
  const denied = events.find((e) => e.crossing === deniedId && e.event === 'crossing.decided');
  check(
    'AC-M1.3',
    !report.invocations.declared_denied.ok &&
      denied?.verdict === 'deny' &&
      denied.reason === 'payload-size-exceeded' &&
      denied.decider === 'program',
    `denied crossing ${deniedId}: verdict=${String(denied?.verdict)} reason=${String(denied?.reason)} decider=${String(denied?.decider)}`,
  );

  const undeclaredId = report.invocations.undeclared.crossing;
  const undeclared = events.find(
    (e) => e.crossing === undeclaredId && e.event === 'crossing.decided',
  );
  check(
    'AC-M1.4',
    !report.invocations.undeclared.ok &&
      undeclared?.verdict === 'deny' &&
      undeclared.reason === 'request-type-undeclared' &&
      !events.some((e) => e.crossing === undeclaredId && e.event === 'crossing.performed'),
    `undeclared crossing ${undeclaredId}: verdict=${String(undeclared?.verdict)} reason=${String(undeclared?.reason)}`,
  );

  check(
    'AC-M1.5',
    report.journal_paths_reachable.length === 0 &&
      JSON.stringify(report.bridge_dir) === JSON.stringify(['bridge.sock']) &&
      !report.mounts.toLowerCase().includes('journal'),
    `journal paths reachable in environment: [${report.journal_paths_reachable.join(',')}]; /bridge contains [${report.bridge_dir.join(',')}]`,
  );

  const names = new Set<string>(EVENT_NAMES);
  const envelopeOk = events.every(
    (e) =>
      names.has(e.event) &&
      typeof e.application_instance === 'string' &&
      typeof e.activation === 'string' &&
      typeof e.flow === 'string' &&
      typeof e.principal === 'object',
  );
  check(
    'AC-M1.6',
    envelopeOk && events.length >= 11,
    `${events.length} events, all names in closed set with full envelope: ${String(envelopeOk)}`,
  );

  console.log(`\njournal: ${journal.file}`);
  console.log(`probe report: ${join(runDir, 'probe-report.json')}`);
  if (failures.length > 0) {
    console.error(`\nFAILED: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('\nAll M1 acceptance criteria verified against this run.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
