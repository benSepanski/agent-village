#!/usr/bin/env node
import { buildCli } from '../src/cli.js';

buildCli()
  .parseAsync(process.argv)
  .catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
