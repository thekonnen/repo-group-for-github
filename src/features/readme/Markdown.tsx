import type { ComponentChildren } from 'preact';
import { parseMarkdown, type Block, type Inline, MAX_README_BYTES } from '../../core/markdown';

/**
 * Renders Markdown as Preact elements built from the parser's AST (C4). There is no innerHTML anywhere: every piece of
 * text is a text node, and links only exist when the parser kept them (http, https, mailto).
 */
export function Markdown({ text }: { text: string }) {
  // Never parse more than the limit, even if a longer text slips through.
  const blocks = parseMarkdown(text.length > MAX_README_BYTES ? text.slice(0, MAX_README_BYTES) : text);
  return <div class="rg-md">{blocks.map((b, i) => <BlockView key={i} b={b} />)}</div>;
}

function Inlines({ c }: { c: Inline[] }) {
  return (
    <>
      {c.map((n, i) => {
        switch (n.t) {
          case 'text': return n.v;
          case 'code': return <code key={i}>{n.v}</code>;
          case 'strong': return <strong key={i}><Inlines c={n.c} /></strong>;
          case 'em': return <em key={i}><Inlines c={n.c} /></em>;
          case 'br': return <br key={i} />;
          case 'link': return <a key={i} href={n.href} rel="noopener noreferrer" target="_blank"><Inlines c={n.c} /></a>;
        }
      })}
    </>
  );
}

function BlockView({ b }: { b: Block }): ComponentChildren {
  switch (b.t) {
    case 'h': {
      const Tag = `h${Math.min(b.n + 1, 6)}` as 'h2'; // the group name is the page's h1
      return <Tag><Inlines c={b.c} /></Tag>;
    }
    case 'p': return <p><Inlines c={b.c} /></p>;
    case 'pre': return <pre><code>{b.v}</code></pre>;
    case 'hr': return <hr />;
    case 'quote': return <blockquote>{b.c.map((x, i) => <BlockView key={i} b={x} />)}</blockquote>;
    case 'list': {
      const items = b.items.map((it, i) => (
        <li key={i}><Inlines c={it.c} />{it.sub.map((x, k) => <BlockView key={k} b={x} />)}</li>
      ));
      return b.ordered ? <ol start={b.start}>{items}</ol> : <ul>{items}</ul>;
    }
    case 'table':
      return (
        <div class="rg-md-table">
          <table>
            <thead><tr>{b.head.map((c, i) => <th key={i} style={b.align[i] ? { textAlign: b.align[i]! } : undefined}><Inlines c={c} /></th>)}</tr></thead>
            <tbody>{b.rows.map((r, i) => <tr key={i}>{r.map((c, k) => <td key={k} style={b.align[k] ? { textAlign: b.align[k]! } : undefined}><Inlines c={c} /></td>)}</tr>)}</tbody>
          </table>
        </div>
      );
  }
}
