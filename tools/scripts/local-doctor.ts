/**
 * Quick health check for the local stack. Prints a green/red table.
 *
 * Usage: pnpm doctor:local
 */
import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb';
import { ListSecretsCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import kleur from 'kleur';
import {
  LOCAL_CREDENTIALS,
  LOCAL_DDB_ENDPOINT,
  LOCAL_ENDPOINT,
  LOCAL_REGION,
  tableName,
} from './local-config.js';

const ENV = process.env['AV_ENV'] ?? 'local';
const expectedTable = tableName(ENV);

interface Check {
  name: string;
  run: () => Promise<string>;
}

const ddb = new DynamoDBClient({
  region: LOCAL_REGION,
  endpoint: LOCAL_DDB_ENDPOINT,
  credentials: LOCAL_CREDENTIALS,
});
const secrets = new SecretsManagerClient({
  region: LOCAL_REGION,
  endpoint: LOCAL_ENDPOINT,
  credentials: LOCAL_CREDENTIALS,
});

const checks: Check[] = [
  {
    name: 'DynamoDB Local reachable',
    run: async () => {
      const out = await ddb.send(new ListTablesCommand({}));
      return `tables: ${(out.TableNames ?? []).length}`;
    },
  },
  {
    name: `DynamoDB table "${expectedTable}" exists`,
    run: async () => {
      const out = await ddb.send(new ListTablesCommand({}));
      if (!(out.TableNames ?? []).includes(expectedTable)) {
        throw new Error('table missing — run pnpm bootstrap:local');
      }
      return 'ok';
    },
  },
  {
    name: 'LocalStack Secrets Manager reachable',
    run: async () => {
      const out = await secrets.send(new ListSecretsCommand({ MaxResults: 1 }));
      return `secrets: ${(out.SecretList ?? []).length}`;
    },
  },
];

async function main(): Promise<void> {
  console.log(kleur.bold(`\n→ doctor (env=${ENV})\n`));
  let failed = 0;
  for (const check of checks) {
    try {
      const detail = await check.run();
      console.log(`${kleur.green('✓')} ${check.name}  ${kleur.dim(detail)}`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`${kleur.red('✗')} ${check.name}  ${kleur.red(msg)}`);
    }
  }
  console.log('');
  if (failed > 0) {
    console.error(kleur.red().bold(`✗ ${failed} check(s) failed`));
    process.exit(1);
  }
  console.log(kleur.green().bold('✓ local stack healthy'));
}

main().catch((err) => {
  console.error(kleur.red('✗ doctor failed unexpectedly:'), err);
  process.exit(1);
});
