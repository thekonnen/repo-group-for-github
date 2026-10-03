// Generates 5 logo concepts (SVG + 512px PNG) into design/brand/options/.
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';

const FOLDER = 'M6 0H26L34 8H70A6 6 0 0 1 76 14V50A6 6 0 0 1 70 56H6A6 6 0 0 1 0 50V6A6 6 0 0 1 6 0Z'; // 76x56
const REPO = 'M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.087a.249.249 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z'; // 16x16
const folder = (x, y, k, fill, extra = '') => `<path d="${FOLDER}" transform="translate(${x} ${y}) scale(${k})" fill="${fill}" ${extra}/>`;
const repo = (x, y, k, fill) => `<path d="${REPO}" transform="translate(${x} ${y}) scale(${k})" fill="${fill}"/>`;
const wrap = (bg, border, body, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">${defs}<rect width="128" height="128" rx="28" fill="${bg}"/><rect x=".75" y=".75" width="126.5" height="126.5" rx="27.25" fill="none" stroke="${border}" stroke-width="1.5"/>${body}</svg>`;
const line = (d, c = '#8b949e', w = 4) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

const options = {};

// 1. Hierarchy tree: root folder -> subfolder + repo -> repos
options[1] = wrap('#0d1117', '#30363d',
  line('M64 44V54M32 54H96M32 54V62M96 54V62M32 88V96') +
  folder(43, 14, 0.62, '#54aeff') +
  folder(14, 62, 0.46, '#3fb950') +
  `<rect x="78" y="62" width="36" height="26" rx="6" fill="#e6edf3"/>` + repo(87, 66, 1.1, '#0969da') +
  `<rect x="18" y="96" width="12" height="12" rx="3" fill="#e6edf3"/><rect x="34" y="96" width="12" height="12" rx="3" fill="#8b949e"/>`);

// 2. Repos peeking out of a folder (light)
options[2] = wrap('#f6f8fa', '#d0d7de',
  folder(14, 20, 1.3, '#0969da') +
  `<g stroke="#d0d7de" stroke-width="1.5" fill="#fff">
     <rect x="26" y="26" width="38" height="46" rx="5" transform="rotate(-9 45 72)"/>
     <rect x="45" y="24" width="38" height="46" rx="5"/>
     <rect x="64" y="26" width="38" height="46" rx="5" transform="rotate(9 83 72)"/></g>` +
  `<circle cx="38" cy="40" r="3.5" fill="#2da44e"/>` +
  `<circle cx="56" cy="38" r="3.5" fill="#54aeff"/>` +
  `<circle cx="90" cy="40" r="3.5" fill="#8250df"/>` +
  `<path d="M14 58a8 8 0 0 1 8-8H105a8 8 0 0 1 8 8V92a8 8 0 0 1-8 8H22a8 8 0 0 1-8-8Z" fill="#54aeff"/>` +
  `<rect x="14" y="58" width="99" height="3" fill="#80ccff"/>`);

// 3. Git-style node graph inside a folder
options[3] = wrap('#0d1117', '#30363d',
  folder(14, 24, 1.3, '#58a6ff') +
  line('M64 52V62M44 66H84M44 66V76M84 66V76', '#0d1117', 4.5) +
  `<circle cx="64" cy="48" r="7" fill="#3fb950" stroke="#0d1117" stroke-width="3"/>` +
  `<circle cx="44" cy="80" r="7" fill="#e6edf3" stroke="#0d1117" stroke-width="3"/>` +
  `<circle cx="84" cy="80" r="7" fill="#e6edf3" stroke="#0d1117" stroke-width="3"/>`);

// 4. Explorer list with indentation (light)
const row = (x, y, fill, barW) => folder(x, y, 0.38, fill) + `<rect x="${x + 36}" y="${y + 7}" width="${barW}" height="8" rx="4" fill="#d0d7de"/>`;
options[4] = wrap('#ffffff', '#d0d7de',
  line('M26 44V70H32M42 70V96H48', '#afb8c1', 3) +
  row(14, 22, '#54aeff', 44) + row(30, 58, '#2da44e', 34) +
  `<rect x="46" y="88" width="29" height="21" rx="4" fill="#f6f8fa" stroke="#d0d7de" stroke-width="1.5"/>` + repo(53, 91, 0.9, '#0969da') +
  `<rect x="82" y="95" width="26" height="8" rx="4" fill="#d0d7de"/>`);

// 5. Nested blocks (groups inside groups inside repos)
options[5] = wrap('#0d1117', '#30363d',
  `<path d="M16 28a8 8 0 0 1 8-8H48L56 28H104a8 8 0 0 1 8 8V100a8 8 0 0 1-8 8H24a8 8 0 0 1-8-8Z" fill="#54aeff"/>` +
  `<rect x="28" y="46" width="72" height="50" rx="7" fill="#3fb950"/>` +
  `<rect x="40" y="58" width="48" height="26" rx="5" fill="#e6edf3"/>` +
  `<rect x="46" y="64" width="10" height="10" rx="2.5" fill="#0969da"/><rect x="60" y="64" width="10" height="10" rx="2.5" fill="#2da44e"/><rect x="74" y="64" width="8" height="10" rx="2.5" fill="#8250df"/>` +
  `<rect x="46" y="77" width="36" height="3" rx="1.5" fill="#afb8c1"/>`);

for (const [n, svg] of Object.entries(options)) {
  writeFileSync(`design/brand/options/option-${n}.svg`, svg);
  writeFileSync(`design/brand/options/option-${n}.png`, new Resvg(svg, { fitTo: { mode: 'width', value: 512 } }).render().asPng());
}
