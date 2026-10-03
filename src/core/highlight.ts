export type TokenClass = 'key' | 'dash' | 'punc' | 'str' | 'const' | 'com' | 'plain';
export interface Token {
  cls: TokenClass;
  text: string;
}

const VALUE_RE =
  /("(?:[^"\\]|\\.)*"?|'[^']*'?)|([[\]{},])|\b(true|false|null|yes|no)\b|(^|\s)(-?\d+(?:\.\d+)?)(?=\s|$|,|\])/g;

function valueTokens(v: string): Token[] {
  const out: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  const plain = (t: string) => t && out.push({ cls: 'plain', text: t });
  VALUE_RE.lastIndex = 0;
  while ((m = VALUE_RE.exec(v))) {
    plain(v.slice(last, m.index));
    if (m[1]) out.push({ cls: 'str', text: m[1] });
    else if (m[2]) out.push({ cls: 'punc', text: m[2] });
    else if (m[3]) out.push({ cls: 'const', text: m[3] });
    else {
      plain(m[4]);
      out.push({ cls: 'const', text: m[5] });
    }
    last = VALUE_RE.lastIndex;
  }
  plain(v.slice(last));
  return out;
}

export function lineTokens(line: string): Token[] {
  let code = line;
  let com = '';
  let inS = false;
  let inD = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && !inS && line[i - 1] !== '\\') inD = !inD;
    else if (c === "'" && !inD) inS = !inS;
    else if (c === '#' && !inS && !inD && (i === 0 || /\s/.test(line[i - 1]))) {
      code = line.slice(0, i);
      com = line.slice(i);
      break;
    }
  }
  const out: Token[] = [];
  let m = code.match(/^(\s*)(-\s+)?([A-Za-z0-9_.-]+)(\s*:)(?=\s|$)(.*)$/);
  if (m) {
    if (m[1]) out.push({ cls: 'plain', text: m[1] });
    if (m[2]) out.push({ cls: 'dash', text: m[2] });
    out.push({ cls: 'key', text: m[3] }, { cls: 'punc', text: m[4] }, ...valueTokens(m[5]));
  } else if ((m = code.match(/^(\s*)(-\s+|-$)(.*)$/))) {
    if (m[1]) out.push({ cls: 'plain', text: m[1] });
    out.push({ cls: 'dash', text: m[2] }, ...valueTokens(m[3]));
  } else if (/^\s*```/.test(code)) out.push({ cls: 'com', text: code });
  else out.push(...valueTokens(code));
  if (com) out.push({ cls: 'com', text: com });
  return out;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Whole-text HTML for the <pre> under the textarea. */
export function highlightHtml(text: string): string {
  return (
    text
      .split('\n')
      .map((l) => lineTokens(l).map((t) => (t.cls === 'plain' ? esc(t.text) : `<span class="rg-t-${t.cls}">${esc(t.text)}</span>`)).join(''))
      .join('\n') + '\n '
  );
}
