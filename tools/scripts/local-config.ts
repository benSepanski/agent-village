export const LOCAL_REGION = 'us-east-1';
export const LOCAL_ENDPOINT = 'http://127.0.0.1:4566';
export const LOCAL_DDB_ENDPOINT = 'http://127.0.0.1:8000';

export const LOCAL_CREDENTIALS = {
  accessKeyId: 'test',
  secretAccessKey: 'test',
};

export function tableName(env: string): string {
  return `agent-village-${env}`;
}
