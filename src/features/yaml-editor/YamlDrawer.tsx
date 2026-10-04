import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { aiText } from '../../core/ai-prompt';
import { diffTrees } from '../../core/diff';
import { highlightHtml } from '../../core/highlight';
import { allRepos, nodeAt } from '../../core/tree';
import { changesText, scopeOptions, scopeWarning, statusSummary } from '../../core/yaml-session';
import { Drawer } from '../../ui/Drawer';
import { Icon } from '../../ui/Icon';
import type { Conflict, Controller, YamlCheck } from '../grouped-view/controller';
import { useStore } from '../store';

/** Edit YAML with the AI round-trip (F8): copy the prompt, paste the answer back, check the diff, commit. */
export function YamlDrawer({ ctl }: { ctl: Controller }) {
  const s = useStore(ctl.store);
  if (!s.yaml) return null;
  return <Editor ctl={ctl} initial={s.yaml.text} scope={s.yaml.scope} />;
}

type CopyKind = 'all' | 'yaml';

function Editor({ ctl, initial, scope: initialScope }: { ctl: Controller; initial: string; scope?: 'ungrouped' }) {
  const s = useStore(ctl.store);
  const model = ctl.model()!;
  const [text, setText] = useState(initial);
  const [check, setCheck] = useState<YamlCheck | null>(null);
  const [scopeId, setScopeId] = useState<'all' | 'ungrouped' | 'group'>(initialScope ?? 'all');
  const [copied, setCopied] = useState<CopyKind | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [problem, setProblem] = useState<{ message: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const ta = useRef<HTMLTextAreaElement>(null);
  const hl = useRef<HTMLPreElement>(null);
  const gut = useRef<HTMLDivElement>(null);
  const fb = useRef<HTMLTextAreaElement>(null);
  const seq = useRef(0);

  // Validation runs in the background (the YAML parser stays out of the page script); only the latest answer counts.
  useEffect(() => {
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const r = await ctl.validateYaml(text);
      if (n === seq.current) setCheck(r);
    }, check ? 120 : 0);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    if (fallback != null) (fb.current?.focus(), fb.current?.select());
  }, [fallback]);

  const saved = s.config && s.config.exists && s.config.config ? s.config.config.groups : [];
  const repos = useMemo(() => allRepos(model.root), [model]);
  const diff = check?.config ? diffTrees(saved, check.config.groups, repos) : null;
  const changes = diff?.items.length ?? 0;
  const canApply = !!check?.config && changes > 0 && !saving && !conflict;

  const options = scopeOptions(model, s.path.length ? nodeAt(model, s.path) : null);
  const scope = options.find((o) => o.id === scopeId) ?? options[0];
  const scoped = scope.id !== 'all';
  const warning = scopeWarning(scope.repos.length);

  const copy = async (kind: CopyKind) => {
    const payload = kind === 'all' ? aiText(s.org, text, scope.repos, scoped) : text;
    try {
      await navigator.clipboard.writeText(payload);
      setFallback(null);
      setCopied(kind);
      setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1500);
    } catch {
      setFallback(payload); // the clipboard API was refused: show the text, selected
    }
  };

  const apply = async () => {
    if (!canApply) return;
    setSaving(true);
    setProblem(null);
    const r = await ctl.applyYaml(text, changes);
    if (!r.ok) {
      if ('conflict' in r) setConflict(r.conflict);
      else setProblem({ message: r.message });
    }
    setSaving(false); // on success the controller closed the drawer
  };

  const onTab = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || e.shiftKey) return; // Shift+Tab still leaves the editor
    e.preventDefault();
    e.stopPropagation();
    const el = e.target as HTMLTextAreaElement;
    const a = el.selectionStart;
    const v = el.value.slice(0, a) + '  ' + el.value.slice(el.selectionEnd);
    el.value = v;
    el.selectionStart = el.selectionEnd = a + 2;
    setText(v);
  };

  const sync = () => {
    if (!ta.current) return;
    if (hl.current) (hl.current.scrollTop = ta.current.scrollTop, (hl.current.scrollLeft = ta.current.scrollLeft));
    if (gut.current) gut.current.scrollTop = ta.current.scrollTop;
  };

  const lineCount = text.split('\n').length;
  const bad = check?.error ? check.line : null;

  return (
    <Drawer
      wide
      title=".github/repo-groups.yml"
      titleId="rg-y-title"
      focus="#rg-y-text"
      onClose={() => ctl.closeYaml()}
      footer={
        <>
          <span class="rg-grow">Commits to <code>{s.org}/.github</code> on the default branch. If that repository does not exist, it is created as private.</span>
          <button type="button" class="rg-btn" onClick={() => ctl.closeYaml()}>Cancel</button>
          <button type="button" class="rg-btn rg-btn-primary" id="rg-y-apply" disabled={!canApply} onClick={() => apply()}>
            <Icon name="check" />{saving ? 'Committing…' : 'Apply and commit'}
          </button>
        </>
      }
    >
      <ol class="rg-y-steps">
        <li><b>Copy prompt for AI + YML</b> and paste it into ChatGPT, Claude or any assistant.</li>
        <li>Paste the answer back here, over the whole file. Code fences are removed for you.</li>
        <li>Check the changes below, then <b>Apply and commit</b>.</li>
      </ol>

      <div class="rg-y-tools rg-copy-row">
        <label class="rg-y-scopewrap">Scope
          <select class="rg-y-scope" value={scope.id} onChange={(e) => setScopeId((e.target as HTMLSelectElement).value as any)}>
            {options.map((o) => <option value={o.id} selected={o.id === scope.id}>{o.label}</option>)}
          </select>
        </label>
        <button type="button" class="rg-btn rg-btn-accent" data-copy="all" onClick={() => copy('all')}><Icon name="sparkle" />{copied === 'all' ? 'Copied' : 'Copy prompt for AI + YML'}</button>
        <button type="button" class="rg-btn" data-copy="yaml" onClick={() => copy('yaml')}><Icon name="copy" />{copied === 'yaml' ? 'Copied' : 'Copy YML'}</button>
        <span class="rg-grow" />
        <button type="button" class="rg-linkish" onClick={() => (setText(ctl.savedText()), setConflict(null))}>Reset to saved file</button>
      </div>
      {warning && <p class="rg-y-scopewarn" role="status">{warning}</p>}

      {fallback != null && (
        <div class="rg-ai-fallback">
          <span class="rg-hint">Your browser blocked copying. The text is selected below; press Ctrl+C or ⌘C.</span>
          <textarea ref={fb} readOnly aria-label="Text to copy" value={fallback} />
        </div>
      )}

      <div class="rg-y-editor">
        <div class="rg-y-gutter" ref={gut} aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => (
            <span key={i}>{bad === i + 1 ? <span class="rg-bad">{i + 1}</span> : i + 1}{'\n'}</span>
          ))}
          {' '}
        </div>
        <div class="rg-y-code">
          <pre class="rg-y-hl" ref={hl} aria-hidden="true" dangerouslySetInnerHTML={{ __html: highlightHtml(text) }} />
          <textarea id="rg-y-text" ref={ta} value={text} spellcheck={false} autocapitalize="off" autocomplete="off" aria-label="repo-groups.yml contents"
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} onScroll={sync} onKeyDown={onTab} />
        </div>
      </div>

      <Status check={check} diff={diff} changes={changes} total={repos.length} />

      {conflict && (
        <div class="rg-callout" role="alert">
          <span><b>The file changed on GitHub since you opened it.</b> Reload to compare your text against the current file; your text is kept.</span>
          <span><button type="button" class="rg-btn" onClick={() => (ctl.rebase(conflict), setConflict(null))}>Reload and keep my text</button></span>
        </div>
      )}
      {problem && <p class="rg-error" role="alert">{problem.message}</p>}
    </Drawer>
  );
}

function Status({ check, diff, changes, total }: { check: YamlCheck | null; diff: ReturnType<typeof diffTrees> | null; changes: number; total: number }) {
  if (!check) return <div class="rg-y-status rg-same" role="status">Checking…</div>;
  if (check.error) {
    return (
      <div class="rg-y-status rg-err" role="status"><Icon name="alert" /><span>{check.error}</span></div>
    );
  }
  const summary = diff ? statusSummary(diff, total, check.stripped) : '';
  return (
    <div class="rg-field">
      {!changes ? (
        <div class="rg-y-status rg-same" role="status"><Icon name="check" /><span>Valid. No changes yet. {summary}</span></div>
      ) : (
        <>
          <div class="rg-y-status rg-ok" role="status"><Icon name="check" /><span>Valid. {changesText(changes)} · {summary}</span></div>
          <ul class="rg-y-diff" aria-label="Changes">
            {diff!.items.map((it, i) => (
              <li key={i}><span class={`rg-k rg-${it.cls}`}>{it.k}</span><span>{it.text}</span><span class="rg-to">{it.to}</span></li>
            ))}
          </ul>
        </>
      )}
      {check.warnings.length > 0 && (
        <div class="rg-y-warns">
          {check.warnings.map((w) => <div class="rg-y-status rg-warn" role="status" key={w}><Icon name="alert" /><span>{w}</span></div>)}
        </div>
      )}
    </div>
  );
}
