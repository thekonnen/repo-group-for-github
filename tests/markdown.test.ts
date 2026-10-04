// @vitest-environment happy-dom
import { h, render } from 'preact';
import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, safeUrl, MAX_README_BYTES } from '../src/core/markdown';
import { Markdown } from '../src/features/readme/Markdown';

const html = (md: string): HTMLElement => {
  const el = document.createElement('div');
  render(h(Markdown, { text: md }), el);
  return el;
};

describe('markdown blocks', () => {
  it('headings, paragraphs and rules', () => {
    const b = parseMarkdown('# Title\n\nHello\nworld\n\n---\n\n###### Six');
    expect(b.map((x) => x.t)).toEqual(['h', 'p', 'hr', 'h']);
    expect(b[0]).toMatchObject({ t: 'h', n: 1 });
    expect(b[3]).toMatchObject({ t: 'h', n: 6 });
    expect((b[1] as any).c).toEqual([{ t: 'text', v: 'Hello\nworld' }]);
  });
  it('unordered, ordered and nested lists', () => {
    const b = parseMarkdown('- a\n- b\n  - b1\n  - b2\n- c\n\n3. x\n4. y');
    expect(b).toHaveLength(2);
    const ul = b[0] as any;
    expect(ul.ordered).toBe(false);
    expect(ul.items).toHaveLength(3);
    expect(ul.items[1].sub[0]).toMatchObject({ t: 'list', items: [{}, {}] });
    expect(b[1]).toMatchObject({ t: 'list', ordered: true, start: 3 });
  });
  it('a blank line between items keeps one list', () => {
    const b = parseMarkdown('- a\n\n- b');
    expect(b).toHaveLength(1);
    expect((b[0] as any).items).toHaveLength(2);
  });
  it('fenced code is verbatim, even with markdown and html inside', () => {
    const b = parseMarkdown('```ts\nconst a = "<b>**x**</b>";\n```\nafter');
    expect(b[0]).toEqual({ t: 'pre', v: 'const a = "<b>**x**</b>";', lang: 'ts' });
    expect(b[1].t).toBe('p');
  });
  it('an unclosed fence runs to the end', () => {
    expect(parseMarkdown('```\nx\ny')[0]).toMatchObject({ t: 'pre', v: 'x\ny' });
  });
  it('blockquote', () => {
    const b = parseMarkdown('> quoted **bold**\n> more');
    expect(b[0]).toMatchObject({ t: 'quote' });
  });
  it('tables with alignment', () => {
    const b = parseMarkdown('| a | b |\n|:--|--:|\n| 1 | 2 |\n| 3 |');
    expect(b[0]).toMatchObject({ t: 'table', align: ['left', 'right'] });
    expect((b[0] as any).rows).toHaveLength(2);
    expect((b[0] as any).rows[1]).toHaveLength(2);
  });
  it('empty and whitespace input give no blocks', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('  \n\n ')).toEqual([]);
  });
});

describe('markdown inline', () => {
  it('bold, italic, code', () => {
    expect(parseInline('a **b** *c* _d_ `e`')).toEqual([
      { t: 'text', v: 'a ' }, { t: 'strong', c: [{ t: 'text', v: 'b' }] }, { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'c' }] }, { t: 'text', v: ' ' }, { t: 'em', c: [{ t: 'text', v: 'd' }] },
      { t: 'text', v: ' ' }, { t: 'code', v: 'e' },
    ]);
  });
  it('snake_case and lone stars stay text', () => {
    expect(parseInline('my_var_name 2 * 3')).toEqual([{ t: 'text', v: 'my_var_name 2 * 3' }]);
  });
  it('links keep http, https and mailto only', () => {
    expect(parseInline('[a](https://x.io/p?q=(1))')[0]).toEqual({ t: 'link', href: 'https://x.io/p?q=(1)', c: [{ t: 'text', v: 'a' }] });
    expect(parseInline('[m](mailto:a@b.co)')[0]).toMatchObject({ t: 'link', href: 'mailto:a@b.co' });
    expect(parseInline('[h](http://x.io "title")')[0]).toMatchObject({ t: 'link', href: 'http://x.io' });
  });
  it('escapes and hard breaks', () => {
    expect(parseInline('\\*not\\*')).toEqual([{ t: 'text', v: '*not*' }]);
    expect(parseInline('a  \nb')).toEqual([{ t: 'text', v: 'a' }, { t: 'br' }, { t: 'text', v: 'b' }]);
  });
});

describe('safeUrl', () => {
  it.each(['https://a.io', 'http://a.io/x', 'mailto:me@a.io', 'HTTPS://A.IO'])('allows %s', (u) => expect(safeUrl(u)).toBeTruthy());
  it.each([
    'javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', '\u0001javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'file:///etc/passwd', 'ftp://a.io', '//evil.io', '/relative', 'relative/path', '#hash', '', 'tel:123',
    'blob:https://a.io/1', 'jav&#x61;script:alert(1)', 'javascript&colon;alert(1)',
  ])('rejects %j', (u) => expect(safeUrl(u)).toBeNull());
});

describe('XSS attempts never reach the DOM as markup', () => {
  const attempts = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<a href="javascript:alert(1)">x</a>',
    '[x](javascript:alert(1))',
    '[x]( javascript:alert(1) )',
    '[x](JaVaScRiPt:alert(1))',
    '[x](java\tscript:alert(1))',
    '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)',
    '[x](vbscript:msgbox(1))',
    '[x](<javascript:alert(1)>)',
    '![x](javascript:alert(1))',
    '![x](https://evil.io/x.png)',
    '<iframe src="https://evil.io"></iframe>',
    '<svg onload=alert(1)>',
    '**<b onmouseover=alert(1)>x</b>**',
    '`<script>alert(1)</script>`',
    '```\n</code></pre><script>alert(1)</script>\n```',
    '> <script>alert(1)</script>',
    '- <img src=x onerror=alert(1)>',
    '| <script>alert(1)</script> |\n|---|\n| <img src=x onerror=alert(1)> |',
    '# <script>alert(1)</script>',
    '[<script>alert(1)</script>](https://a.io)',
    '[a](https://a.io" onmouseover="alert(1))',
    '<!-- --><script>alert(1)</script>',
    '[x](https://a.io/\u0000javascript:alert(1))',
  ];
  it.each(attempts)('%j', (src) => {
    const el = html(src);
    expect(el.querySelector('script, iframe, img, svg, object, embed, style, form, input')).toBeNull();
    for (const node of el.querySelectorAll('*')) {
      for (const a of node.getAttributeNames()) expect(a.startsWith('on')).toBe(false);
    }
    for (const a of el.querySelectorAll('a')) {
      expect(a.getAttribute('href')).toMatch(/^(https?:|mailto:)/i);
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });
  it('shows raw html as visible text', () => {
    expect(html('<b>hi</b>').textContent).toContain('<b>hi</b>');
  });
  it('every link carries rel noopener noreferrer and opens in a new tab', () => {
    const a = html('[a](https://a.io)').querySelector('a')!;
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.getAttribute('target')).toBe('_blank');
  });
  it('an unsafe link keeps its words but has no anchor', () => {
    const el = html('[click me](javascript:alert(1))');
    expect(el.querySelector('a')).toBeNull();
    expect(el.textContent).toBe('click me');
  });
});

describe('robustness', () => {
  it('pathological input stays fast', () => {
    const t = Date.now();
    parseMarkdown('*a '.repeat(20000));
    parseMarkdown('['.repeat(20000));
    parseMarkdown('> '.repeat(500) + 'x');
    parseMarkdown('- a\n' + '  - a\n'.repeat(2000));
    parseMarkdown('**'.repeat(20000));
    expect(Date.now() - t).toBeLessThan(3000);
  });
  it('the view never parses more than the limit', () => {
    const el = html('a'.repeat(MAX_README_BYTES + 5000));
    expect(el.textContent!.length).toBe(MAX_README_BYTES);
  });
  it('renders headings one level down (the group name is the h1)', () => {
    const el = html('# T\n\n## U');
    expect(el.querySelector('h1')).toBeNull();
    expect(el.querySelectorAll('h2, h3')).toHaveLength(2);
  });
});
