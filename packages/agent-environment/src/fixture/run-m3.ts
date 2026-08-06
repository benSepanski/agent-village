import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Activation } from '../activation.js';
import { declareTopologyFile } from '../declare.js';
import type { JournalEvent } from '../events.js';
import { Journal } from '../journal.js';
import {
  computeUnit,
  computeUnitOf,
  environmentExists,
  environmentLogs,
  removeEnvironment,
  startEnvironment,
  UndeclaredMountError,
  waitEnvironment,
  type MountRequest,
} from '../runtime.js';
import type { EnvironmentDecl } from '../topology.js';
import { mountRequestsFor, VolumeStore } from '../volumes.js';

/**
 * The documented M3 fixture command (milestone verification, steps 2-6):
 * declare the M3 topology, run one activation across a flow boundary —
 * writer, then reader, then a refused undeclared-mount start, then the
 * session reset, then the writer again in the next flow — and check every
 * M3 acceptance criterion against the journal and the probes' reports.
 * Exits non-zero if any criterion fails.
 */

interface WriteOutcome {
  path: string;
  outcome: 'written' | 'refused';
  detail: string;
}

interface ProbeReport {
  mode: string;
  volumes_visible: string[];
  listings: Record<string, string[]>;
  reads: Record<string, string>;
  writes: WriteOutcome[];
  errors: string[];
}

const here = dirname(fileURLToPath(import.meta.url));

async function runProbe(opts: {
  name: string;
  environment: EnvironmentDecl;
  mounts: MountRequest[];
  appDir: string;
  mode: string;
  store: VolumeStore;
  journal: Journal;
}): Promise<{ report: ProbeReport; exitCode: number; computeUnit: string }> {
  const env = await startEnvironment({
    name: opts.name,
    environment: opts.environment,
    mounts: opts.mounts,
    codeDir: opts.appDir,
    entrypoint: 'probe/run-m3.js',
    args: [opts.mode],
  });
  for (const mount of opts.mounts) {
    opts.journal.emit({
      event: 'volume.mounted',
      principal: { kind: 'runtime' },
      turn: null,
      volume: mount.volume,
      version: opts.store.digest(mount.volume),
      environment: opts.environment.name,
      role: mount.role,
      mode: mount.mode,
      subtree: mount.subtree,
    });
  }
  const unit = await computeUnitOf(env);
  opts.journal.emit({
    event: 'instance.started',
    principal: { kind: 'runtime' },
    turn: null,
    environment: opts.environment.name,
    container: env.container,
    compute_unit: unit,
  });
  const exitCode = await waitEnvironment(env);
  const logs = await environmentLogs(env);
  await removeEnvironment(env);
  opts.journal.emit({
    event: 'instance.stopped',
    principal: { kind: 'runtime' },
    turn: null,
    environment: opts.environment.name,
    container: env.container,
    exit_code: exitCode,
  });
  const report = JSON.parse(logs.trim().split('\n').at(-1) ?? '{}') as ProbeReport;
  return { report, exitCode, computeUnit: unit };
}

async function main(): Promise<void> {
  const topologyPath = process.argv[2] ?? resolve(here, '..', '..', 'fixtures', 'm3-topology.json');

  const runId = randomBytes(4).toString('hex');
  const runDir = join(tmpdir(), `agent-environment-m3-${runId}`);
  mkdirSync(runDir, { recursive: true });

  const journal = new Journal(join(runDir, 'journal.jsonl'), {
    application_instance: `ai-${runId}`,
    activation: `act-${runId}`,
    flow: 'flow-1',
  });

  const declared = declareTopologyFile(journal, topologyPath);
  if (!declared.accepted) {
    for (const violation of declared.violations) {
      console.error(`topology refused: ${violation.reason}: ${violation.detail}`);
    }
    console.error(`instance not started; journal: ${journal.file}`);
    process.exit(1);
  }
  const topology = declared.topology;
  const writer = topology.environments.find((e) => e.name === 'writer');
  const reader = topology.environments.find((e) => e.name === 'reader');
  if (!writer || !reader) {
    console.error('the M3 fixture runner drives the writer and reader environments of its fixture');
    process.exit(1);
  }

  const store = new VolumeStore(join(runDir, 'volumes'), topology.volumes);
  // The zero-writer volume is provisioned by the platform at instance
  // creation — no environment writes it, which is what keeps it immutable.
  writeFileSync(
    join(store.hostPath('prompts', '/'), 'system-prompt.md'),
    'You are the M3 probe. Prompts live on a zero-writer volume.\n',
    'utf8',
  );

  const appDir = join(runDir, 'app');
  mkdirSync(join(appDir, 'probe'), { recursive: true });
  copyFileSync(join(resolve(here, '..'), 'probe', 'run-m3.js'), join(appDir, 'probe', 'run-m3.js'));

  const activation = new Activation(journal);
  activation.start(await computeUnit());

  const writerFlow1 = await runProbe({
    name: `ae-m3-writer-f1-${runId}`,
    environment: writer,
    mounts: mountRequestsFor(writer, store),
    appDir,
    mode: 'writer-flow1',
    store,
    journal,
  });

  const readerRun = await runProbe({
    name: `ae-m3-reader-${runId}`,
    environment: reader,
    mounts: mountRequestsFor(reader, store),
    appDir,
    mode: 'reader',
    store,
    journal,
  });

  // The hostile start: a runtime request naming a mount the topology does not
  // declare for this environment. It must refuse before any container exists.
  const undeclaredName = `ae-m3-undeclared-${runId}`;
  let undeclaredRefusal: string | null = null;
  try {
    await startEnvironment({
      name: undeclaredName,
      environment: reader,
      mounts: [
        ...mountRequestsFor(reader, store),
        {
          volume: 'scratch',
          role: 'reader',
          mode: 'read-only',
          subtree: '/',
          host_path: store.hostPath('scratch', '/'),
        },
      ],
      codeDir: appDir,
      entrypoint: 'probe/run-m3.js',
      args: ['reader'],
    });
  } catch (err) {
    if (err instanceof UndeclaredMountError) undeclaredRefusal = err.message;
  }
  const undeclaredStarted = await environmentExists(undeclaredName);

  // The flow boundary: session volumes are digested, destroyed, and recreated
  // before the next flow begins. volume.reset carries the pre-reset digest and
  // is stamped with the flow that is ending.
  const preResetDigests = new Map<string, string>();
  for (const volume of store.sessionVolumes()) {
    const version = store.resetSession(volume);
    preResetDigests.set(volume, version);
    journal.emit({
      event: 'volume.reset',
      principal: { kind: 'runtime' },
      turn: null,
      volume,
      version,
    });
  }
  const emptyScratchDigest = store.digest('scratch');
  journal.beginFlow('flow-2');

  const writerFlow2 = await runProbe({
    name: `ae-m3-writer-f2-${runId}`,
    environment: writer,
    mounts: mountRequestsFor(writer, store),
    appDir,
    mode: 'writer-flow2',
    store,
    journal,
  });

  for (const volume of store.volumeNames()) {
    journal.emit({
      event: 'volume.digest',
      principal: { kind: 'runtime' },
      turn: null,
      volume,
      version: store.digest(volume),
    });
  }
  activation.end('completed');

  const events = readFileSync(journal.file, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as JournalEvent & Record<string, unknown>);

  const failures: string[] = [];
  const check = (id: string, ok: boolean, detail: string) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
    if (!ok) failures.push(id);
  };

  const probesClean =
    writerFlow1.exitCode === 0 && readerRun.exitCode === 0 && writerFlow2.exitCode === 0;
  check(
    'probes',
    probesClean,
    `probe exits: writer-flow1=${String(writerFlow1.exitCode)} reader=${String(readerRun.exitCode)} writer-flow2=${String(writerFlow2.exitCode)}`,
  );

  check(
    'AC-M3.1',
    JSON.stringify(readerRun.report.volumes_visible) === JSON.stringify(['prompts', 'shared']) &&
      undeclaredRefusal !== null &&
      !undeclaredStarted,
    `reader sees volumes [${readerRun.report.volumes_visible.join(',')}] (scratch absent); undeclared mount request refused: ${undeclaredRefusal ?? 'NOT REFUSED'}; container started: ${String(undeclaredStarted)}`,
  );

  const scratchPreReset = preResetDigests.get('scratch');
  const reset = events.find((e) => e.event === 'volume.reset' && e.volume === 'scratch');
  const scratchMountFlow2 = events.find(
    (e) => e.event === 'volume.mounted' && e.volume === 'scratch' && e.flow === 'flow-2',
  );
  check(
    'AC-M3.2',
    JSON.stringify(writerFlow2.report.listings['/volumes/scratch']) === JSON.stringify([]) &&
      reset !== undefined &&
      reset.version === scratchPreReset &&
      reset.flow === 'flow-1' &&
      scratchPreReset !== emptyScratchDigest &&
      scratchMountFlow2?.version === emptyScratchDigest,
    `scratch at flow-2 start: [${(writerFlow2.report.listings['/volumes/scratch'] ?? ['<missing>']).join(',')}]; volume.reset version=${String(reset?.version)} (pre-reset, non-empty: ${String(scratchPreReset !== emptyScratchDigest)}) in flow ${String(reset?.flow)}`,
  );

  const started = events.filter((e) => e.event === 'instance.started');
  const activationStarted = events.find((e) => e.event === 'activation.started');
  const terminal = events.filter((e) => e.event === 'activation.ended');
  const units = new Set(
    [activationStarted, ...started].map((e) => String(e?.compute_unit ?? 'missing')),
  );
  check(
    'AC-M3.3',
    started.length === 3 && units.size === 1 && !units.has('missing') && terminal.length === 1,
    `${String(started.length)} instances on compute unit(s) [${[...units].join(',')}] = activation's; terminal events: ${String(terminal.length)}`,
  );

  const promptWrite = readerRun.report.writes.find((w) => w.path.startsWith('/volumes/prompts'));
  const sharedWrite = readerRun.report.writes.find((w) => w.path.startsWith('/volumes/shared'));
  check(
    'AC-M3.4',
    promptWrite?.outcome === 'refused' &&
      promptWrite.detail.includes('EROFS') &&
      sharedWrite?.outcome === 'refused' &&
      sharedWrite.detail.includes('EROFS'),
    `write to zero-writer volume: ${String(promptWrite?.outcome)} (${String(promptWrite?.detail)}); write through read-only mount: ${String(sharedWrite?.outcome)}`,
  );

  const writerSaw = writerFlow1.report.listings['/volumes/shared'] ?? [];
  const readerSaw = readerRun.report.listings['/volumes/shared'] ?? [];
  check(
    'AC-M3.5',
    writerSaw.includes('secret/hidden.txt') &&
      JSON.stringify(readerSaw) === JSON.stringify(['note.txt']) &&
      readerRun.report.reads['/volumes/shared/note.txt'] === 'flow-1 public note',
    `writer sees [${writerSaw.join(',')}]; reader (subtree public) sees [${readerSaw.join(',')}]`,
  );

  console.log(`\njournal: ${journal.file}`);
  if (failures.length > 0) {
    console.error(`\nFAILED: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('\nAll M3 acceptance criteria verified against this run.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
