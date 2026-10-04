/**
 * A tiny, dependency-free Markdown parser for group READMEs (C4). It returns a plain AST, never HTML: the view turns the
 * AST into Preact elements, so text can only ever become text nodes. Raw HTML in the source is shown as text, and links
 * are kept only for http, https and mailto. No DOM, no chrome.*.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'br' };

export type Align = 'left' | 'center' | 'right' | null;

export type Block =
  | { t: 'h'; n: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'pre'; v: string; lang: string }
  | { t: 'hr' }
  | { t: 'quote'; c: Block[] }
  | { t: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { t: 'table'; head: Inline[][]; align: Align[]; rows: Inline[][][] };

export interface ListItem {
  c: Inline[];
  /** Nested blocks, from indented lines (usually a list). */
  sub: Block[];
}

/** A README is at most 64 KB (bytes of UTF-8). */
export const MAX_README_BYTES = 64 * 1024;

const MAX_DEPTH = 8;
const MISS_LIMIT = 200;
const ALLOWED = new Set(['http:', 'https:', 'mailto:']);

/** The link target when it is http, https or mailto; otherwise null (the text is shown without a link). */
export function safeUrl(raw: string): string | null {
  // Browsers ignore tabs, newlines and control characters inside a URL, so look at the URL without them.
  // eslint-disable-next-line no-control-regex
  const u = raw.replace(/[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, '');
  if (!u || u.length > 2048) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) return null; // relative, protocol-relative and "//host" links are not allowed
  try {
    return ALLOWED.has(new URL(u).protocol) ? u : null;
  } catch {
    return null;
  }
}

const isEscapable = (c: string): boolean => '\\`*_{}[]()#+-.!|<>~"\'&/:'.includes(c);

/** Index of the `)` that closes a link target starting at `i`, honoring balanced parentheses; -1 when missing. */
function closeParen(s: string, i: number): number {
  let depth = 1;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (c === '\\') k++;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return k;
  }
  return -1;
}

/** Index of the `]` that closes a link label starting at `i`; -1 when missing. */
function closeBracket(s: string, i: number): number {
  let depth = 1;
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (c === '\\') k++;
    else if (c === '`') {
      const end = s.indexOf('`', k + 1);
      if (end > 0) k = end;
    } else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return k;
  }
  return -1;
}

const wordChar = (c: string | undefined): boolean => !!c && /[\p{L}\p{N}]/u.test(c);

/** Inline Markdown: code, links, bold, italic, line breaks. Everything else is text. */
export function parseInline(src: string, depth = 0): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ t: 'text', v: text });
    text = '';
  };
  // Unclosed `[` or `*` make the scan look to the end of the text; after a few misses the rest stays plain text.
  let misses = 0;
  const nested = () => depth < MAX_DEPTH && misses < MISS_LIMIT;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      if (src[i + 1] === '\n') {
        flush();
        out.push({ t: 'br' });
        i += 2;
      } else if (i + 1 < src.length && isEscapable(src[i + 1])) {
        text += src[i + 1];
        i += 2;
      } else {
        text += c;
        i++;
      }
      continue;
    }
    if (c === '`') {
      let n = 1;
      while (src[i + n] === '`') n++;
      const fence = '`'.repeat(n);
      const end = src.indexOf(fence, i + n);
      if (end > 0) {
        flush();
        let v = src.slice(i + n, end).replace(/\n/g, ' ');
        if (v.length > 2 && v.startsWith(' ') && v.endsWith(' ') && v.trim()) v = v.slice(1, -1);
        out.push({ t: 'code', v });
        i = end + n;
        continue;
      }
      text += fence;
      i += n;
      continue;
    }
    if (c === '[' && nested()) {
      const close = closeBracket(src, i + 1);
      if (close > 0 && src[close + 1] === '(') {
        const end = closeParen(src, close + 2);
        if (end > 0) {
          const dest = src.slice(close + 2, end).trim();
          const url = dest.startsWith('<') && dest.includes('>') ? dest.slice(1, dest.indexOf('>')) : dest.split(/\s+/)[0];
          const href = safeUrl(url);
          const label = parseInline(src.slice(i + 1, close), depth + 1);
          flush();
          if (href) out.push({ t: 'link', href, c: label });
          else out.push(...label); // unsafe or relative target: keep the words, drop the link
          i = end + 1;
          continue;
        }
      }
      misses++;
    }
    if ((c === '*' || c === '_') && nested()) {
      const double = src[i + 1] === c;
      const mark = double ? c + c : c;
      const from = i + mark.length;
      // `_` only opens at a word edge, so snake_case_names stay plain.
      const opens = c === '*' || !wordChar(src[i - 1]);
      if (opens && src[from] && !/\s/.test(src[from])) {
        let end = from;
        for (;;) {
          end = src.indexOf(mark, end);
          if (end < 0) break;
          const afterOk = c === '*' || !wordChar(src[end + mark.length]);
          const lone = !double && (src[end + 1] === c || src[end - 1] === c);
          if (end > from && !/\s/.test(src[end - 1]) && afterOk && !lone) break;
          end++;
        }
        if (end > 0) {
          flush();
          out.push({ t: double ? 'strong' : 'em', c: parseInline(src.slice(from, end), depth + 1) });
          i = end + mark.length;
          continue;
        }
      }
      misses++;
    }
    if (c === ' ' && src[i + 1] === ' ' && src[i + 2] === '\n') {
      flush();
      out.push({ t: 'br' });
      i += 3;
      continue;
    }
    if (c === '\n') {
      text = text.replace(/ +$/, '') + '\n';
      i++;
      continue;
    }
    text += c;
    i++;
  }
  flush();
  return out;
}

const HR = /^ {0,3}([-*_])(?: *\1){2,} *$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([\w+#.-]*)[^`]*$/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const TABLE_SEP = /^ *\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$/;

const indentOf = (l: string): number => l.length - l.trimStart().length;

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (s[i] === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += s[i];
  }
  cells.push(cur.trim());
  return cells;
}

const alignOf = (cell: string): Align => {
  const l = cell.startsWith(':');
  const r = cell.endsWith(':');
  return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
};

const startsBlock = (l: string): boolean => HR.test(l) || HEADING.test(l) || FENCE.test(l) || QUOTE.test(l) || ITEM.test(l);

/** Block Markdown: headings, paragraphs, code blocks, lists, quotes, rules, tables. */
export function parseMarkdown(src: string, depth = 0): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const mark = fence[1];
      const closing = new RegExp(`^ {0,3}${mark[0]}{${mark.length},}[ \\t]*$`);
      const body: string[] = [];
      i++;
      while (i < lines.length && !closing.test(lines[i])) body.push(lines[i++]);
      i++; // the closing fence, or the end of the text
      out.push({ t: 'pre', v: body.join('\n'), lang: fence[2] });
      continue;
    }
    if (HR.test(line)) {
      out.push({ t: 'hr' });
      i++;
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      out.push({ t: 'h', n: h[1].length as 1, c: parseInline((h[2] ?? '').trim()) });
      i++;
      continue;
    }
    if (QUOTE.test(line) && depth < MAX_DEPTH) {
      const body: string[] = [];
      while (i < lines.length && lines[i].trim() && (QUOTE.test(lines[i]) || !startsBlock(lines[i]))) {
        const m = QUOTE.exec(lines[i]);
        body.push(m ? m[1] : lines[i]);
        i++;
      }
      out.push({ t: 'quote', c: parseMarkdown(body.join('\n'), depth + 1) });
      continue;
    }
    if (ITEM.test(line) && depth < MAX_DEPTH) {
      const r = parseList(lines, i, depth);
      out.push(r.block);
      i = r.next;
      continue;
    }
    if (i + 1 < lines.length && line.includes('|') && TABLE_SEP.test(lines[i + 1])) {
      const head = splitRow(line);
      const sep = splitRow(lines[i + 1]);
      if (head.length === sep.length) {
        const rows: Inline[][][] = [];
        i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
          const cells = splitRow(lines[i++]);
          rows.push(head.map((_, k) => parseInline(cells[k] ?? '')));
        }
        out.push({ t: 'table', head: head.map((c) => parseInline(c)), align: sep.map(alignOf), rows });
        continue;
      }
    }
    const para: string[] = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) para.push(lines[i++].trim());
    out.push({ t: 'p', c: parseInline(para.join('\n')) });
  }
  return out;
}

function parseList(lines: string[], from: number, depth: number): { block: Extract<Block, { t: 'list' }>; next: number } {
  const first = ITEM.exec(lines[from])!;
  const base = first[1].length;
  const ordered = /\d/.test(first[2]);
  const items: ListItem[] = [];
  let i = from;
  while (i < lines.length) {
    // a single blank line between two items of the same list does not end it
    if (!lines[i].trim() && i + 1 < lines.length && ITEM.exec(lines[i + 1])?.[1].length === base) i++;
    const m = ITEM.exec(lines[i]);
    if (!m || m[1].length !== base || /\d/.test(m[2]) !== ordered) break;
    const text: string[] = [m[3]];
    const nested: string[] = [];
    let cut = 0;
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) {
        // a blank line only belongs to the item when an indented line follows
        if (i + 1 < lines.length && lines[i + 1].trim() && indentOf(lines[i + 1]) > base) {
          if (nested.length) nested.push('');
          i++;
          continue;
        }
        break;
      }
      const ind = indentOf(l);
      if (ind > base) {
        if (!nested.length && !ITEM.test(l) && !FENCE.test(l)) text.push(l.trim());
        else {
          if (!nested.length) cut = ind;
          nested.push(l.slice(Math.min(ind, cut)));
        }
        i++;
      } else if (ind <= base && startsBlock(l)) break;
      else {
        text.push(l.trim()); // lazy continuation of the item's paragraph
        i++;
      }
    }
    items.push({ c: parseInline(text.join('\n')), sub: nested.length ? parseMarkdown(nested.join('\n'), depth + 1) : [] });
  }
  const n = parseInt(first[2], 10);
  return { block: { t: 'list', ordered, start: ordered && n > 0 ? n : 1, items }, next: i };
}
