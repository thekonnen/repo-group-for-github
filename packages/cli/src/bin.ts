import { readFile } from 'node:fs/promises';
import { runCli } from './cli';
import { serveStdio } from './mcp';

// Entry point of dist/rg.mjs. `rg mcp` serves MCP on stdio (stdout carries protocol messages only; logs go to stderr).
// Shared client code logs with console.debug/log; on stdout that would corrupt the MCP stream.
console.debug = console.info = console.log = console.error;
const log = console.error;
const argv = process.argv.slice(2);
const env = process.env;
const doFetch = (url: string, init?: RequestInit) => fetch(url, init);

async function readStdin(): Promise<string> {
  let s = '';
  for await (const c of process.stdin) s += c.toString();
  return s;
}

if (argv[0] === 'mcp') {
  await serveStdio(process.stdin, (line) => process.stdout.write(line + '\n'), { env, fetch: doFetch });
} else {
  process.exitCode = await runCli(argv, {
    env,
    fetch: doFetch,
    out: (s) => process.stdout.write(s + '\n'),
    err: (s) => log(s),
    readFile: (p) => readFile(p, 'utf8'),
    readStdin,
  });
}
