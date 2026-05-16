/**
 * Idempotently provisions the local DynamoDB table + a placeholder secret in
 * LocalStack Secrets Manager. Safe to re-run any time.
 *
 * Usage: pnpm bootstrap:local
 */
import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceInUseException,
  ResourceNotFoundException,
} from '@aws-sdk/client-dynamodb';
import {
  CreateSecretCommand,
  ResourceExistsException,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import kleur from 'kleur';
import {
  LOCAL_CREDENTIALS,
  LOCAL_DDB_ENDPOINT,
  LOCAL_ENDPOINT,
  LOCAL_REGION,
  tableName,
} from './local-config.js';

const ENV = process.env['AV_ENV'] ?? 'local';

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

async function ensureTable(): Promise<void> {
  const name = tableName(ENV);
  try {
    await ddb.send(new DescribeTableCommand({ TableName: name }));
    console.log(kleur.green('✓'), `table ${name} already exists`);
    return;
  } catch (err) {
    if (!(err instanceof ResourceNotFoundException)) throw err;
  }

  try {
    await ddb.send(
      new CreateTableCommand({
        TableName: name,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'pk', AttributeType: 'S' },
          { AttributeName: 'sk', AttributeType: 'S' },
          { AttributeName: 'gsi1pk', AttributeType: 'S' },
          { AttributeName: 'gsi1sk', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'pk', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: 'gsi1',
            KeySchema: [
              { AttributeName: 'gsi1pk', KeyType: 'HASH' },
              { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
            ],
            Projection: { ProjectionType: 'ALL' },
          },
        ],
      }),
    );
    console.log(kleur.green('✓'), `created table ${name}`);
  } catch (err) {
    if (err instanceof ResourceInUseException) {
      console.log(kleur.yellow('~'), `table ${name} created concurrently`);
      return;
    }
    throw err;
  }
}

async function ensureDemoSecret(): Promise<void> {
  const name = `agent-village/${ENV}/demo/anthropic-key`;
  try {
    await secrets.send(
      new CreateSecretCommand({
        Name: name,
        SecretString: 'sk-ant-demo-local-development-only',
        Description: 'Local-only demo Anthropic API key. Never real.',
      }),
    );
    console.log(kleur.green('✓'), `created demo secret ${name}`);
  } catch (err) {
    if (err instanceof ResourceExistsException) {
      console.log(kleur.green('✓'), `demo secret ${name} already exists`);
      return;
    }
    throw err;
  }
}

async function main(): Promise<void> {
  console.log(kleur.bold(`\n→ bootstrapping local stack for env=${ENV}\n`));
  await ensureTable();
  await ensureDemoSecret();
  console.log(kleur.bold().green('\n✓ local stack ready\n'));
}

main().catch((err) => {
  console.error(kleur.red('✗ bootstrap failed:'), err);
  process.exit(1);
});
