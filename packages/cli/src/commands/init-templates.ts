// Content templates for `village init` — kept separate from init.ts so each
// file stays small. Every generated file must satisfy the platform schemas:
// manifest.json parses as ApplicationManifest, agent.json as CreateAgentInput.
const NAME_MAX_LENGTH = 80;
// Matches the major version examples/gmail-agent/package.json pins.
const ANTHROPIC_SDK_VERSION = '^0.110.0';

/** Sanitize a directory basename into a valid, friendly manifest/agent name. */
export function sanitizeAppName(raw: string): string {
  const kebab = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const truncated = kebab.slice(0, NAME_MAX_LENGTH);
  return truncated.length > 0 ? truncated : 'app';
}

export function manifestTemplate(name: string): unknown {
  return {
    name,
    image: 'sandbox-base',
    command: [
      'bash',
      '-c',
      `cp -R /workspace/${name} /tmp/app && cd /tmp/app && npm ci --omit=dev --no-audit --no-fund && node app.mjs`,
    ],
    // Informational only — set the agent's own `schedule` to make this run.
    schedule: 'cron(0 12 * * ? *)',
    timeoutMinutes: 10,
    egressAllow: ['registry.npmjs.org'],
    grants: [],
    env: {},
    flushIntervalSeconds: 0,
  };
}

export function packageJsonTemplate(name: string): unknown {
  return {
    name,
    private: true,
    type: 'module',
    dependencies: {
      '@anthropic-ai/sdk': ANTHROPIC_SDK_VERSION,
    },
  };
}

export function agentJsonTemplate(name: string): unknown {
  return {
    name,
    model: 'claude-haiku-4-5',
    // Replace with real instructions before creating the agent.
    systemPrompt: 'You are a one-off agent-village app. Replace this system prompt.',
    schedule: 'rate(1 day)',
    spendLimitUsd: 5,
    // Placeholder — replace with a real Anthropic API key before `agents create`.
    anthropicApiKey: 'sk-ant-REPLACE_ME',
  };
}

export function gitignoreTemplate(): string {
  return 'node_modules\n';
}

export function appMjsTemplate(name: string): string {
  return `// Minimal agent-village app scaffold — reads/writes state in the durable
// workspace and makes one metered Anthropic call per run.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

// The base-image entrypoint syncs the durable workspace to /workspace
// (AV_WORKSPACE_DIR override supported for local testing).
const workspaceDir = process.env.AV_WORKSPACE_DIR ?? '/workspace';
const stateFile = path.join(workspaceDir, '${name}', 'state.json');

async function loadState() {
  try {
    return JSON.parse(await readFile(stateFile, 'utf8'));
  } catch {
    return { runCount: 0 };
  }
}

async function saveState(state) {
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, \`\${JSON.stringify(state)}\\n\`, 'utf8');
}

async function main() {
  const state = await loadState();
  // The SDK picks up ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY from the
  // platform-injected env, so every call is metered against spendLimitUsd.
  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 256,
    messages: [{ role: 'user', content: \`This is run #\${state.runCount + 1}. Say hello.\` }],
  });
  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\\n');
  console.log(text);
  state.runCount += 1;
  await saveState(state);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
`;
}

export function readmeTemplate(name: string): string {
  return `# ${name}

Scaffolded by \`village init\` — a one-off agent-village application. See the
platform's \`docs/app-development.md\` for the full app contract (what's
injected, what's enforced, custom images, etc).

**Before doing anything else:**

1. Replace the \`anthropicApiKey\` placeholder in \`agent.json\` with a real key.
2. Generate a lockfile so the in-sandbox \`npm ci\` is reproducible:
   \`npm install --package-lock-only\`.

## Lifecycle

Run these from this directory, in order:

\`\`\`sh
village login
village agents create --file agent.json
village workspace push <agentId> . --dest ${name}
village agents manifest <agentId> manifest.json
village run <agentId>
village logs <agentId> <runId> --follow
\`\`\`

Edit \`app.mjs\` to do something more interesting than say hello, and
\`manifest.json\` to adjust the schedule, timeout, egress allowlist, and any
tool grants or plain env config the app needs.
`;
}
