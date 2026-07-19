import { readFile } from 'node:fs/promises';

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

/** Read and JSON-parse a file, or stdin when `path` is `-`. */
export async function readJsonFile(
  path: string,
  stdin: NodeJS.ReadableStream = process.stdin,
): Promise<unknown> {
  const text = path === '-' ? await readStream(stdin) : await readFile(path, 'utf8');
  return JSON.parse(text) as unknown;
}
