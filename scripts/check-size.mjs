// Reports the size budgets from CLAUDE.md §10. Informational by default (final size is not a concern while features
// are being built); pass --strict to fail on an exceeded budget. Run after `npm run build`.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const dir = args.find((a) => !a.startsWith('--')) ?? '.output/chrome-mv3';
const KB = 1024;
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
let files;
try { files = walk(dir); } catch { console.error(`No build at ${dir}. Run "npm run build" first.`); process.exit(2); }

const total = files.reduce((n, f) => n + statSync(f).size, 0);
const content = files.filter((f) => /content-scripts\/.*\.js$/.test(f)).reduce((n, f) => n + statSync(f).size, 0);
const yamlChunk = files.filter((f) => /(yaml|js-yaml).*\.js$/i.test(f) && !/content-scripts/.test(f)).reduce((n, f) => n + statSync(f).size, 0);
const checks = [
  ['Content script (minified)', content, 60 * KB],
  ['YAML editor chunk', yamlChunk, 60 * KB],
  ['Total packaged extension', total, 250 * KB],
];
let bad = false;
for (const [name, size, max] of checks) {
  const ok = size <= max; bad ||= !ok;
  console.log(`${ok ? 'ok  ' : strict ? 'FAIL' : 'warn'} ${name}: ${(size / KB).toFixed(1)} KB (max ${max / KB} KB)`);
}
process.exit(bad && strict ? 1 : 0);
