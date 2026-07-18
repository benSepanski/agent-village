import { Command } from 'commander';
import { agentsList } from './commands/agents-list.js';
import { agentsManifest } from './commands/agents-manifest.js';
import { agentsShow } from './commands/agents-show.js';
import { doctor } from './commands/doctor.js';
import { logs } from './commands/logs.js';
import { run } from './commands/run.js';
import { secretsList } from './commands/secrets-list.js';
import { secretsRm } from './commands/secrets-rm.js';
import { secretsSet } from './commands/secrets-set.js';

function registerSecrets(program: Command): void {
  const secrets = program
    .command('secrets')
    .description('Per-agent secret values (never echoed back)');
  secrets
    .command('set <agentId> <name>')
    .description('Store a secret value from --value, --from-file, or stdin')
    .option('--value <value>', 'Inline value (prefer --from-file or stdin: shell history)')
    .option('--from-file <path>', 'Read the value from a file')
    .action(async (agentId: string, name: string, opts: { value?: string; fromFile?: string }) => {
      process.stdout.write(`${await secretsSet(agentId, name, opts)}\n`);
    });
  secrets
    .command('list <agentId>')
    .description("List an agent's secret names (values are never shown)")
    .action(async (agentId: string) => {
      process.stdout.write(`${await secretsList(agentId)}\n`);
    });
  secrets
    .command('rm <agentId> <name>')
    .description('Delete one secret')
    .action(async (agentId: string, name: string) => {
      process.stdout.write(`${await secretsRm(agentId, name)}\n`);
    });
}

function registerAgents(program: Command): void {
  const agents = program.command('agents').description('Agent CRUD over HTTP');
  agents
    .command('list')
    .description('List my agents')
    .action(async () => {
      process.stdout.write(`${await agentsList()}\n`);
    });
  agents
    .command('show <agentId>')
    .description('Show one agent and its recent runs')
    .action(async (agentId: string) => {
      process.stdout.write(`${await agentsShow(agentId)}\n`);
    });
  agents
    .command('manifest <agentId> [manifestPath]')
    .description('Attach an application manifest from a JSON file, or --detach to remove it')
    .option('--detach', 'Detach the current manifest (revert to inline agent)')
    .action(
      async (agentId: string, manifestPath: string | undefined, opts: { detach?: boolean }) => {
        process.stdout.write(
          `${await agentsManifest(agentId, { manifestPath, detach: opts.detach })}\n`,
        );
      },
    );
}

export function buildCli(): Command {
  const program = new Command();
  program.name('village').description('Agent Village CLI');

  registerAgents(program);
  registerSecrets(program);

  program
    .command('run <agentId>')
    .description('Trigger a one-off run')
    .option('--dry-run', 'Skip the Anthropic call (cap max_tokens at 256)')
    .action(async (agentId: string, opts: { dryRun?: boolean }) => {
      process.stdout.write(`${await run(agentId, opts)}\n`);
    });

  program
    .command('logs <agentId> <runId>')
    .description('Show run detail plus its sandbox logs; --follow tails a running run')
    .option('--follow', 'Poll for new log events until the run finishes')
    .action(async (agentId: string, runId: string, opts: { follow?: boolean }) => {
      process.stdout.write(`${await logs(agentId, runId, opts)}\n`);
    });

  const env = program.command('env').description('Local-environment diagnostics');
  env
    .command('doctor')
    .description('Check that local dev stack and env vars are ready')
    .action(async () => {
      process.stdout.write(`${await doctor()}\n`);
    });

  return program;
}
