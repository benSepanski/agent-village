import kleur from 'kleur';

interface Check {
  name: string;
  check: () => Promise<boolean>;
}

async function checkApiUrl(): Promise<boolean> {
  return Boolean(process.env['AV_API_URL']);
}

async function checkAccessToken(): Promise<boolean> {
  return Boolean(process.env['AV_ACCESS_TOKEN']);
}

async function checkLocalStack(): Promise<boolean> {
  const endpoint = process.env['AV_DYNAMO_ENDPOINT'] ?? 'http://localhost:8000';
  try {
    const res = await fetch(endpoint, { method: 'GET' });
    return res.status < 500;
  } catch {
    return false;
  }
}

const CHECKS: Check[] = [
  { name: 'AV_API_URL is set', check: checkApiUrl },
  { name: 'AV_ACCESS_TOKEN is set (or refresh token configured)', check: checkAccessToken },
  { name: 'DynamoDB Local reachable', check: checkLocalStack },
];

export async function doctor(): Promise<string> {
  const lines: string[] = [];
  for (const c of CHECKS) {
    const ok = await c.check();
    lines.push(`${ok ? kleur.green('✓') : kleur.red('✗')}  ${c.name}`);
  }
  return lines.join('\n');
}
