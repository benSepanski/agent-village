import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * The M3 probe: a script, not a model, run inside an environment with only
 * its declared mounts. Mount enforcement is only observable from inside —
 * what is visible under /volumes, what a write to a read-only mount does —
 * so its stdout is the evidence the fixture runner collects (AC-M3.1,
 * AC-M3.4, AC-M3.5).
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

const report: ProbeReport = {
  mode: process.argv[2] ?? 'unknown',
  volumes_visible: [],
  listings: {},
  reads: {},
  writes: [],
  errors: [],
};

function tryWrite(path: string, content: string): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
    report.writes.push({ path, outcome: 'written', detail: 'write succeeded' });
  } catch (err) {
    report.writes.push({ path, outcome: 'refused', detail: String(err) });
  }
}

function list(path: string): void {
  try {
    report.listings[path] = readdirSync(path, { recursive: true })
      .map((entry) => entry.toString())
      .sort();
  } catch (err) {
    report.errors.push(`listing ${path}: ${String(err)}`);
  }
}

function read(path: string): void {
  try {
    report.reads[path] = readFileSync(path, 'utf8');
  } catch (err) {
    report.errors.push(`reading ${path}: ${String(err)}`);
  }
}

try {
  report.volumes_visible = readdirSync('/volumes').sort();
} catch (err) {
  report.errors.push(`listing /volumes: ${String(err)}`);
}

switch (report.mode) {
  case 'writer-flow1':
    tryWrite('/volumes/shared/public/note.txt', 'flow-1 public note');
    tryWrite('/volumes/shared/secret/hidden.txt', 'flow-1 secret, outside the reader subtree');
    tryWrite('/volumes/scratch/state.txt', 'flow-1 conversation state');
    list('/volumes/shared');
    list('/volumes/scratch');
    break;
  case 'reader':
    list('/volumes/shared');
    list('/volumes/prompts');
    read('/volumes/shared/note.txt');
    read('/volumes/prompts/system-prompt.md');
    tryWrite('/volumes/prompts/injected.txt', 'a write to a zero-writer volume must fail');
    tryWrite('/volumes/shared/injected.txt', 'a write through a read-only mount must fail');
    break;
  case 'writer-flow2':
    list('/volumes/scratch');
    list('/volumes/shared');
    tryWrite('/volumes/scratch/state.txt', 'flow-2 conversation state');
    break;
  default:
    report.errors.push(`unknown probe mode ${report.mode}`);
}

process.stdout.write(`${JSON.stringify(report)}\n`);
if (report.errors.length > 0) process.exitCode = 1;
