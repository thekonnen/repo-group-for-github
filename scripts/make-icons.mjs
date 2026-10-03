// Renders design/brand/extension-icon-small.svg to the extension icons in public/icon.
// Bold shapes on purpose: fine detail turns to mush at 16-48px.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';
const svg = readFileSync('design/brand/extension-icon-small.svg', 'utf8');
for (const s of [16, 32, 48, 128]) {
  writeFileSync(`public/icon/${s}.png`, new Resvg(svg, { fitTo: { mode: 'width', value: s } }).render().asPng());
}
