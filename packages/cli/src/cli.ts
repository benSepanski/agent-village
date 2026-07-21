import { Command } from 'commander';
import type { AdminUsersActionOptions } from './commands/admin-cognito.js';
import { adminUsersDisable } from './commands/admin-users-disable.js';
import { adminUsersEnable } from './commands/admin-users-enable.js';
import { adminUsersList } from './commands/admin-users-list.js';
import { adminUsersResetPassword } from './commands/admin-users-reset-password.js';
import { agentsCreate } from './commands/agents-create.js';
import { agentsList } from './commands/agents-list.js';
import { agentsManifest } from './commands/agents-manifest.js';
import { agentsRm } from './commands/agents-rm.js';
import { agentsShow } from './commands/agents-show.js';
import { agentsUpdate } from './commands/agents-update.js';
import { budgetSet } from './commands/budget-set.js';
import { budgetShow } from './commands/budget-show.js';
import { doctor } from './commands/doctor.js';
import { init } from './commands/init.js';
import { login } from './commands/login.js';
import { logout } from './commands/logout.js';
import { logs } from './commands/logs.js';
import { run } from './commands/run.js';
import { secretsList } from './commands/secrets-list.js';
import { secretsRm } from './commands/secrets-rm.js';
import { secretsSet } from './commands/secrets-set.js';
import { workspaceLs } from './commands/workspace-ls.js';
import { workspacePull } from './commands/workspace-pull.js';
import { workspacePush } from './commands/workspace-push.js';
import { workspaceRm } from './commands/workspace-rm.js';

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

function registerAgentsRead(agents: Command): void {
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

function registerAgentsLifecycle(agents: Command): void {
  agents
    .command('create')
    .description('Create an agent from a CreateAgentInput JSON file (or - for stdin)')
    .requiredOption('--file <path>', "Path to the agent JSON, or '-' for stdin")
    .action(async (opts: { file: string }) => {
      process.stdout.write(`${await agentsCreate({ file: opts.file })}\n`);
    });
  agents
    .command('update <agentId>')
    .description('Update an agent from an UpdateAgentInput JSON file (or - for stdin)')
    .requiredOption('--file <path>', "Path to the agent JSON, or '-' for stdin")
    .action(async (agentId: string, opts: { file: string }) => {
      process.stdout.write(`${await agentsUpdate(agentId, { file: opts.file })}\n`);
    });
  agents
    .command('rm <agentId>')
    .description('Delete an agent')
    .option('--yes', 'Skip the confirmation prompt')
    .action(async (agentId: string, opts: { yes?: boolean }) => {
      process.stdout.write(`${await agentsRm(agentId, { yes: opts.yes })}\n`);
    });
}

function registerAgents(program: Command): void {
  const agents = program.command('agents').description('Agent CRUD over HTTP');
  registerAgentsRead(agents);
  registerAgentsLifecycle(agents);
}

function registerBudget(program: Command): void {
  const budget = program
    .command('budget')
    .description("Caller's monthly spend budget (GET /me/budget)")
    .action(async () => {
      process.stdout.write(`${await budgetShow()}\n`);
    });
  budget
    .command('set <usd>')
    .description('Set (or change) the monthly budget cap in USD')
    .action(async (usd: string) => {
      process.stdout.write(`${await budgetSet(usd)}\n`);
    });
}

function registerWorkspace(program: Command): void {
  const workspace = program
    .command('workspace')
    .description("An agent's durable S3 workspace (synced into /workspace on each run)");
  workspace
    .command('ls <agentId>')
    .description('List files in the workspace')
    .action(async (agentId: string) => {
      process.stdout.write(`${await workspaceLs(agentId)}\n`);
    });
  workspace
    .command('push <agentId> <localPath>')
    .description('Upload a local file or directory into the workspace')
    .option('--dest <subdir>', 'Workspace-relative destination prefix')
    .action(async (agentId: string, localPath: string, opts: { dest?: string }) => {
      process.stdout.write(`${await workspacePush(agentId, localPath, { dest: opts.dest })}\n`);
    });
  workspace
    .command('pull <agentId> [destDir]')
    .description('Download workspace files into a local directory (default: .)')
    .option('--prefix <subdir>', 'Only pull entries under this workspace-relative prefix')
    .action(async (agentId: string, destDir: string | undefined, opts: { prefix?: string }) => {
      process.stdout.write(`${await workspacePull(agentId, destDir, { prefix: opts.prefix })}\n`);
    });
  workspace
    .command('rm <agentId> <path>')
    .description('Delete one file from the workspace')
    .action(async (agentId: string, path: string) => {
      process.stdout.write(`${await workspaceRm(agentId, path)}\n`);
    });
}

function registerAdminUsersCommand(
  users: Command,
  name: string,
  description: string,
  action: (email: string, opts: AdminUsersActionOptions) => Promise<string>,
): void {
  users
    .command(`${name} <email>`)
    .description(description)
    .requiredOption('--env <env>', 'dev or prod')
    .option('--region <region>', 'AWS region (default: AWS_REGION env, then us-east-1)')
    .option(
      '--user-pool-id <id>',
      'Skip pool discovery (default: AV_USER_POOL_ID env, then ListUserPools by name)',
    )
    .action(async (email: string, opts: AdminUsersActionOptions) => {
      process.stdout.write(`${await action(email, opts)}\n`);
    });
}

function registerAdminUsers(admin: Command): void {
  const users = admin
    .command('users')
    .description(
      'Cognito user administration — operator AWS credentials (default provider chain), not the village API',
    );
  users
    .command('list')
    .description('List every user in the pool')
    .requiredOption('--env <env>', 'dev or prod')
    .option('--region <region>', 'AWS region (default: AWS_REGION env, then us-east-1)')
    .option(
      '--user-pool-id <id>',
      'Skip pool discovery (default: AV_USER_POOL_ID env, then ListUserPools by name)',
    )
    .action(async (opts: AdminUsersActionOptions) => {
      process.stdout.write(`${await adminUsersList(opts)}\n`);
    });
  registerAdminUsersCommand(
    users,
    'disable',
    'Block sign-in for one user (reversible)',
    adminUsersDisable,
  );
  registerAdminUsersCommand(users, 'enable', 'Restore sign-in for one user', adminUsersEnable);
  registerAdminUsersCommand(
    users,
    'reset-password',
    'Send a Cognito password-reset code (Cognito-native users only)',
    adminUsersResetPassword,
  );
}

function registerAdmin(program: Command): void {
  const admin = program
    .command('admin')
    .description('Operator-only commands using your own AWS credentials (not the village API)');
  registerAdminUsers(admin);
}

function registerAuth(program: Command): void {
  program
    .command('login')
    .description('Sign in and persist non-secret CLI config (~/.config/agent-village/config.json)')
    .option('--api-url <url>', 'API base URL (persisted; required on first login)')
    .option('--region <region>', 'AWS region for the Cognito CLI client (persisted)')
    .option('--client-id <clientId>', 'Cognito CLI app client id (persisted)')
    .option('--email <email>', 'Sign-in email (otherwise prompted)')
    .action(
      async (opts: { apiUrl?: string; region?: string; clientId?: string; email?: string }) => {
        process.stdout.write(`${await login(opts)}\n`);
      },
    );

  program
    .command('logout')
    .description('Clear stored CLI credentials')
    .action(async () => {
      process.stdout.write(`${await logout()}\n`);
    });
}

export function buildCli(): Command {
  const program = new Command();
  program.name('village').description('Agent Village CLI');

  registerAuth(program);
  registerAgents(program);
  registerBudget(program);
  registerSecrets(program);
  registerWorkspace(program);
  registerAdmin(program);

  program
    .command('init <dir>')
    .description('Scaffold a new one-off agent-village app in <dir>')
    .action(async (dir: string) => {
      process.stdout.write(`${await init(dir)}\n`);
    });

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
