import { useMemo, useState } from 'preact/hooks';
import { finalName, slugName, validateDraft, type Edit } from '../../core/edit';
import { matches } from '../../core/glob';
import { byPush, nodeAt } from '../../core/tree';
import { Drawer } from '../../ui/Drawer';
import { Icon } from '../../ui/Icon';
import type { Controller, SaveResult } from '../grouped-view/controller';
import { useStore } from '../store';

const MAX_LISTED = 200;

/** Edit group (F5) and New group / New subgroup (F6): the same drawer in two modes. */
export function GroupDrawer({ ctl }: { ctl: Controller }) {
  const s = useStore(ctl.store);
  const d = s.drawer;
  if (!d) return null;
  return <Form key={`${d.mode}:${d.path.join('/')}`} ctl={ctl} mode={d.mode} path={d.path} />;
}

function Form({ ctl, mode, path }: { ctl: Controller; mode: 'edit' | 'new'; path: string[] }) {
  const s = ctl.store.get();
  const model = ctl.model()!;
  const groups = s.config && s.config.exists && s.config.config ? s.config.config.groups : [];
  const node = mode === 'edit' ? nodeAt(model, path) : null;
  const parentKey = mode === 'new' ? path.join('/') : path.slice(0, -1).join('/');

  const [name, setName] = useState(node?.group.name ?? '');
  const [description, setDescription] = useState(node?.group.description ?? '');
  const [rules, setRules] = useState<string[]>(node?.group.match ?? []);
  const [ruleInput, setRuleInput] = useState('');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<{ message: string; needsRepo?: boolean } | null>(null);

  const error = validateDraft(groups, { mode, path, name });
  const showError = error && (touched || !error.startsWith('Name is required'));
  const dirty = mode === 'new' || !node || name !== node.group.name || description !== node.group.description || rules.join('\n') !== node.group.match.join('\n');

  /** Reads the field itself, not state: a fast Enter after typing or pasting must not lose text. */
  const addRule = (v: string) => {
    v = v.trim();
    if (v && !rules.includes(v)) setRules([...rules, v]);
    setRuleInput('');
  };

  const hits = useMemo(() => s.repos.filter((r) => !r.archived && rules.length && matches(rules, r.name)).sort(byPush), [s.repos, rules]);
  const here = mode === 'edit' ? path.join('/') : null;

  const edit: Edit =
    mode === 'edit' ? { kind: 'edit', path, name, description, match: rules } : { kind: 'new', parent: path, name, description, match: rules };

  const submit = async (create = false) => {
    setTouched(true);
    if (error || saving) return;
    setSaving(true);
    setProblem(null);
    const r: SaveResult = create ? await ctl.createRepoAndSave(edit) : await ctl.save(edit);
    if (!r.ok) setProblem({ message: r.message, needsRepo: r.needsRepo });
    setSaving(false); // on success the controller closed the drawer
  };

  const fullPath = [s.org, ...(parentKey ? parentKey.split('/') : []), finalName(name) || '…'].join(' / ');
  const title = mode === 'edit' ? `Edit group ${path.join(' / ')}` : path.length ? 'New subgroup' : 'New group';

  return (
    <Drawer
      title={title}
      titleId="rg-drawer-title"
      onClose={() => ctl.closeDrawer()}
      footer={
        <>
          <span class="rg-grow">Saved as a commit to <code>{s.org}/.github</code>. Everyone in the organization sees the change.</span>
          <button type="button" class="rg-btn" onClick={() => ctl.closeDrawer()}>Cancel</button>
          <button type="button" class="rg-btn rg-btn-primary" disabled={saving || !!error || !dirty} onClick={() => submit()}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <form class="rg-form" onSubmit={(e) => (e.preventDefault(), submit())}>
        <div class="rg-field">
          <label for="rg-f-name">Name</label>
          <input id="rg-f-name" class="rg-input rg-mono" value={name} autocomplete="off" aria-invalid={showError ? 'true' : undefined} aria-describedby="rg-f-name-hint"
            onInput={(e) => (setName(slugName((e.target as HTMLInputElement).value)), setProblem(null))} onBlur={() => setTouched(true)} />
          <span class="rg-hint" id="rg-f-name-hint">{showError ? <span class="rg-error" role="alert">{error}</span> : <>Lowercase letters, numbers, <code>-</code> <code>_</code> <code>.</code> · {fullPath}</>}</span>
        </div>

        <div class="rg-field">
          <label for="rg-f-desc">Description</label>
          <input id="rg-f-desc" class="rg-input" value={description} autocomplete="off" placeholder="One short sentence" onInput={(e) => setDescription((e.target as HTMLInputElement).value)} />
        </div>

        <div class="rg-field">
          <label for="rg-f-rule">Match rules</label>
          <div class="rg-chips">
            {rules.map((r, i) => (
              <span class="rg-chip" key={r}>{r}
                <button type="button" aria-label={`Remove rule ${r}`} onClick={() => setRules(rules.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button>
              </span>
            ))}
          </div>
          <div class="rg-add-rule">
            <input id="rg-f-rule" class="rg-input rg-mono" value={ruleInput} placeholder="dags-*  or  exact-name" autocomplete="off"
              onInput={(e) => setRuleInput((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addRule((e.target as HTMLInputElement).value))} />
            <button type="button" class="rg-btn" onClick={() => addRule(ruleInput)} disabled={!ruleInput.trim()}>Add</button>
          </div>
          <span class="rg-hint">Use <code>*</code> as a wildcard. An exact name always wins; otherwise the deepest group wins.</span>
        </div>

        <div class="rg-field">
          <label>Matching repositories ({hits.length})</label>
          {hits.length ? (
            <ul class="rg-match-list" aria-label="Matching repositories">
              {hits.slice(0, MAX_LISTED).map((r) => {
                const at = model.placed.get(r.name) ?? '';
                const elsewhere = at && at !== here;
                return (
                  <li key={r.name}>
                    <Icon name="repo" size={14} />
                    <span>{r.name}</span>
                    {elsewhere && <span class="rg-moved">now in {at.split('/').join(' / ')}</span>}
                  </li>
                );
              })}
              {hits.length > MAX_LISTED && <li class="rg-muted">and {hits.length - MAX_LISTED} more</li>}
            </ul>
          ) : (
            <span class="rg-hint">{rules.length ? 'No repository matches these rules yet.' : 'Add a rule to see which repositories it catches.'}</span>
          )}
        </div>

        {problem?.needsRepo ? (
          <div class="rg-callout" role="alert">
            <span>The repository <code>{s.org}/.github</code> does not exist yet. Create it as a private repository to store <code>repo-groups.yml</code>?</span>
            <span><button type="button" class="rg-btn rg-btn-primary" disabled={saving} onClick={() => submit(true)}>Create {s.org}/.github and save</button></span>
          </div>
        ) : (
          problem && <p class="rg-error" role="alert">{problem.message}</p>
        )}
      </form>
    </Drawer>
  );
}
