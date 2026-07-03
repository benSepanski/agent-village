import { Command } from 'commander';
import { agentsList } from './commands/agents-list.js';
import { agentsManifest } from './commands/agents-manifest.js';
import { agentsShow } from './commands/agents-show.js';
import { doctor } from './commands/doctor.js';
import { logs } from './commands/logs.js';
import { run } from './commands/run.js';

export function buildCli(): Command {
  const program = new Command();
  program.name('village').description('Agent Village CLI');

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

  program
    .command('run <agentId>')
    .description('Trigger a one-off run')
    .option('--dry-run', 'Skip the Anthropic call (cap max_tokens at 256)')
    .action(async (agentId: string, opts: { dryRun?: boolean }) => {
      process.stdout.write(`${await run(agentId, opts)}\n`);
    });

  program
    .command('logs <agentId> <runId>')
    .description('Show the detail/timeline for one run')
    .action(async (agentId: string, runId: string) => {
      process.stdout.write(`${await logs(agentId, runId)}\n`);
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
