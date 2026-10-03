// Renders design/brand/logo.svg to PNG: extension icons (public/icon) and a 512px logo.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
const svg = readFileSync('design/brand/logo.svg', 'utf8');
const out = (size, path) => writeFileSync(path, new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());
for (const s of [16, 32, 48, 128]) out(s, `public/icon/${s}.png`);
out(512, 'design/brand/logo.png');
