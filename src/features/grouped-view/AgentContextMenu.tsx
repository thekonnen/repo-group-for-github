import { useEffect, useRef, useState } from 'preact/hooks';
import { buildAgentsSnippet, buildGroupContext, contextFilename } from '../../core/agent-context';
import type { GroupNode } from '../../core/tree';
import { t } from '../../i18n';
import { Icon } from '../../ui/Icon';

/** Saves text as a file with a blob download (no network). */
export function downloadText(name: string, text: string, doc: Document = document): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = doc.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  doc.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface Props {
  org: string;
  node: GroupNode;
  layer?: 'org' | 'my';
  teams?: string[];
}

/** Header menu: copy or download a group as Markdown context for AI coding agents, or copy an AGENTS.md snippet. Local only. */
export function AgentContextMenu({ org, node, layer = 'org', teams }: Props) {
  const [note, setNote] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  const fb = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (fallback != null) (fb.current?.focus(), fb.current?.select());
  }, [fallback]);

  const pack = () => buildGroupContext({ org, node, layer, teams, readme: (node.group as { readme?: string }).readme });
  const omittedNote = (omitted: number) => (omitted ? ' ' + t('agentCtxOmitted', omitted.toLocaleString()) : '');

  const copy = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setFallback(null);
      setNote(done);
    } catch {
      setFallback(text); // the clipboard API was refused: show the text, selected
      setNote(t('agentCtxFallback'));
    }
  };

  const onCopy = () => {
    const r = pack();
    void copy(r.text, t('agentCtxCopied') + omittedNote(r.omitted));
  };
  const onDownload = () => {
    const r = pack();
    const name = contextFilename(org, node.path);
    downloadText(name, r.text);
    setFallback(null);
    setNote(t('agentCtxDownloaded', name) + omittedNote(r.omitted));
  };
  const onSnippet = () => void copy(buildAgentsSnippet({ org, node, layer }), t('agentCtxSnippetCopied'));

  return (
    <details class="rg-ctx" ref={menu} onToggle={() => { const o = !!menu.current?.open; setOpen(o); if (!o) (setNote(null), setFallback(null)); }}>
      <summary class="rg-btn" aria-haspopup="menu"><Icon name="copy" />{t('agentCtxMenu')}</summary>
      {open && <div class="rg-ctx-panel" role="menu">
        <button type="button" role="menuitem" class="rg-ctx-item" onClick={onCopy}>{t('agentCtxCopy')}</button>
        <button type="button" role="menuitem" class="rg-ctx-item" onClick={onDownload}>{t('agentCtxDownload')}</button>
        <button type="button" role="menuitem" class="rg-ctx-item" onClick={onSnippet}>{t('agentCtxSnippet')}</button>
        {note && <div class="rg-ctx-note rg-muted" role="status">{note}</div>}
        {fallback != null && <textarea ref={fb} class="rg-ctx-fallback" readOnly rows={6} aria-label={t('agentCtxCopy')} value={fallback} />}
      </div>}
    </details>
  );
}
