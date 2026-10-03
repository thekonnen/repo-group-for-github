import { useEffect, useMemo, useState } from 'preact/hooks';
import { applyEdit, cleanTeams, displayName, finalName, slugify, slugName, splitRules, validateDraft, type Edit } from '../../core/edit';
import { matches } from '../../core/glob';
import { effectiveTeams } from '../../core/teams';
import { byPush, nodeAt, type TreeModel } from '../../core/tree';
import type { TeamTag } from '../../core/types';
import { writeConfig } from '../../core/yaml-write';
import { Drawer } from '../../ui/Drawer';
import { Icon } from '../../ui/Icon';
import { LogoField, type LogoDraft } from '../logo-cropper/LogoField';
import { useLogoSrc } from '../logos/logo-store';
import type { Controller, SaveResult } from '../grouped-view/controller';
import { useStore } from '../store';
import { TeamsField } from '../teams/TeamsField';

const MAX_LISTED = 200;

/** "infra/dagu" -> "Infra / Dagu" using display names. */
const titled = (model: TreeModel, key: string): string =>
  key
    .split('/')
    .map((_, i, parts) => {
      const g = model.byKey.get(parts.slice(0, i + 1).join('/'))?.group;
      return g ? displayName(g) : parts[i];
    })
    .join(' / ');

/** Edit group (F5) and New group / New subgroup (F6): the same drawer in two modes. */
export function GroupDrawer({ ctl }: { ctl: Controller }) {
  const s = useStore(ctl.store);
  const d = s.drawer;
  if (!d) return null;
  return <Form key={`${d.mode}:${d.path.join('/')}`} ctl={ctl} mode={d.mode} path={d.path} focusLogo={d.focus === 'logo'} />;
}

function Form({ ctl, mode, path, focusLogo }: { ctl: Controller; mode: 'edit' | 'new'; path: string[]; focusLogo: boolean }) {
  const s = ctl.store.get();
  const model = ctl.model()!;
  const groups = s.config && s.config.exists && s.config.config ? s.config.config.groups : [];
  const node = mode === 'edit' ? nodeAt(model, path) : null;
  const parentKey = mode === 'new' ? path.join('/') : path.slice(0, -1).join('/');

  // Name is what people read ("Grupo: Competição"); the slug is the path used in URLs and files ("grupo-competicao").
  const [title, setTitle] = useState(node ? displayName(node.group) : '');
  const [slug, setSlug] = useState(node?.group.name ?? '');
  // A new group's slug follows its name until the slug is edited; an existing slug never changes by itself (it is in URLs).
  const [slugTouched, setSlugTouched] = useState(mode === 'edit');
  const [description, setDescription] = useState(node?.group.description ?? '');
  const [rules, setRules] = useState<string[]>(node?.group.match ?? []);
  // Teams (F12): own tags are edited here; tags inherited from ancestors are shown read-only.
  const [teams, setTeams] = useState<TeamTag[]>(node?.group.teams ?? []);
  const tv = useStore(ctl.teams.store);
  useEffect(() => void ctl.teams.ensureList(), []);
  const teamsDirty = !!node && JSON.stringify(cleanTeams(teams)) !== JSON.stringify(node.group.teams);
  const parentPath = mode === 'edit' ? path.slice(0, -1) : path;
  const inherited = Object.entries(effectiveTeams(groups, parentPath))
    .filter(([slug]) => !teams.some((t) => t.slug === slug))
    .map(([slug, t]) => ({ slug, permission: t.permission, from: titled(model, t.from) }));
  const savedSlugs = node ? Object.keys(effectiveTeams(groups, path)) : [];
  const [ruleInput, setRuleInput] = useState('');
  const [logo, setLogo] = useState<LogoDraft>({ kind: 'keep' });
  const currentLogo = useLogoSrc(ctl.logos, node?.group.logo);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<{ message: string; needsRepo?: boolean } | null>(null);

  // Text still sitting in the rule field when Save is pressed counts too.
  const allRules = [...new Set([...rules, ...splitRules(ruleInput)])];

  const error = validateDraft(groups, { mode, path, name: slug, title });
  const nameError = error === 'Name is required.' ? error : null;
  const slugError = error && !nameError ? error : null;
  const dirty =
    mode === 'new' ||
    !node ||
    title.trim() !== displayName(node.group) ||
    finalName(slug) !== node.group.name ||
    description !== node.group.description ||
    allRules.join('\n') !== node.group.match.join('\n') ||
    teamsDirty ||
    logo.kind !== 'keep';

  const onTitle = (v: string) => {
    setTitle(v);
    setProblem(null);
    if (!slugTouched) setSlug(slugify(v));
  };

  /** Reads the field itself, not state: a fast Enter after typing or pasting must not lose text. "a, b c" adds three rules. */
  const addRules = (v: string) => {
    const add = splitRules(v).filter((r) => !rules.includes(r));
    if (add.length) setRules([...rules, ...add]);
    setRuleInput('');
  };

  const hits = useMemo(() => s.repos.filter((r) => !r.archived && allRules.length && matches(allRules, r.name)).sort(byPush), [s.repos, ruleInput, rules]);
  const here = mode === 'edit' ? path.join('/') : null;

  const logoChange = logo.kind === 'png' ? { png: logo.png } : logo.kind === 'remove' ? { remove: true as const } : undefined;
  const edit: Edit =
    mode === 'edit'
      ? { kind: 'edit', path, name: slug, title, description, match: allRules, ...(logoChange && { logo: logoChange }), ...(teamsDirty ? { teams } : {}) }
      : { kind: 'new', parent: path, name: slug, title, description, match: allRules, ...(logoChange && { logo: logoChange }), ...(teams.length ? { teams } : {}) };

  const submit = async (create = false) => {
    setTouched(true);
    if (error || saving) return;
    setSaving(true);
    setProblem(null);
    const r: SaveResult = create ? await ctl.createRepoAndSave(edit) : await ctl.save(edit);
    if (!r.ok) setProblem({ message: r.message, needsRepo: r.needsRepo });
    setSaving(false); // on success the controller closed the drawer
  };

  /** Opens the YAML editor with this draft already applied to the file. */
  const openInYaml = () => {
    const cfg = s.config && s.config.exists && s.config.config ? s.config.config : { version: 1, index: 'api' as const, groups: [] };
    let yaml = ctl.savedText();
    if (!error) {
      // A cropped PNG is committed together with this form's Save, not by the YAML editor: leave it out of the preview.
      const forYaml: Edit = logoChange && 'png' in logoChange ? { ...edit, logo: undefined } : edit;
      const r = applyEdit(cfg.groups, forYaml);
      if ('groups' in r) yaml = writeConfig({ ...cfg, groups: r.groups }, `${s.org}/.github/repo-groups.yml`);
    }
    ctl.openYaml(yaml);
  };

  const fullPath = [s.org, ...(parentKey ? titled(model, parentKey).split(' / ') : []), finalName(slug) || '…'].join(' / ');
  const heading = mode === 'edit' ? `Edit group ${titled(model, path.join('/'))}` : path.length ? 'New subgroup' : 'New group';

  return (
    <Drawer
      title={heading}
      titleId="rg-drawer-title"
      onClose={() => ctl.closeDrawer()}
      focus={focusLogo ? '#rg-logo-upload' : '#rg-f-name'}
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
        <LogoField name={finalName(slug) || '?'} label={title.trim() || slug} current={currentLogo} hasLogo={!!node?.group.logo} draft={logo} onChange={setLogo} fetchLink={ctl.fetchLogoLink} />

        <div class="rg-field">
          <label for="rg-f-name">Name</label>
          <input id="rg-f-name" class="rg-input" value={title} autocomplete="off" aria-invalid={nameError && touched ? 'true' : undefined} aria-describedby="rg-f-name-hint"
            onInput={(e) => onTitle((e.target as HTMLInputElement).value)} onBlur={() => setTouched(true)} />
          <span class="rg-hint" id="rg-f-name-hint">{nameError && touched ? <span class="rg-error" role="alert">{nameError}</span> : 'Capitals, spaces and accents are fine, for example “Grupo: Competição”.'}</span>
        </div>

        <div class="rg-field">
          <label for="rg-f-slug">Slug</label>
          <input id="rg-f-slug" class="rg-input rg-mono" value={slug} autocomplete="off" aria-invalid={slugError ? 'true' : undefined} aria-describedby="rg-f-slug-hint"
            onInput={(e) => (setSlug(slugName((e.target as HTMLInputElement).value)), setSlugTouched(true), setProblem(null))} />
          <span class="rg-hint" id="rg-f-slug-hint">{slugError ? <span class="rg-error" role="alert">{slugError}</span> : <>Used in the URL and in the file: lowercase letters, numbers, <code>-</code> <code>_</code> <code>.</code> · {fullPath}</>}</span>
        </div>

        <div class="rg-field">
          <label for="rg-f-desc">Description</label>
          <input id="rg-f-desc" class="rg-input" value={description} autocomplete="off" placeholder="One short sentence" onInput={(e) => setDescription((e.target as HTMLInputElement).value)} />
        </div>

        {!s.access?.personal && <TeamsField
          org={s.org}
          teams={teams}
          onChange={(t) => (setTeams(t), setProblem(null))}
          inherited={inherited}
          list={tv.list}
          loading={tv.listLoading}
          customRoles={tv.customRoles ? Object.keys(tv.customRoles) : undefined}
          onSync={mode === 'edit' && savedSlugs.length ? () => void ctl.teams.openSync({ teams: savedSlugs, groupKey: path.join('/') }) : undefined}
          syncNote={teamsDirty ? 'Save your team changes first. Sync access uses the saved file.' : null}
        />}

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
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value;
                if (/[\s,;]/.test(v) && splitRules(v).length) addRules(v); // a comma or space ends a rule, like a tag field
                else setRuleInput(v);
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addRules((e.target as HTMLInputElement).value))} />
            <button type="button" class="rg-btn" onClick={() => addRules(ruleInput)} disabled={!ruleInput.trim()}>Add</button>
          </div>
          <span class="rg-hint">Separate several with commas. Use <code>*</code> as a wildcard. An exact name always wins; otherwise the deepest group wins.</span>
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
                    {elsewhere && <span class="rg-moved">now in {titled(model, at)}</span>}
                  </li>
                );
              })}
              {hits.length > MAX_LISTED && <li class="rg-muted">and {hits.length - MAX_LISTED} more</li>}
            </ul>
          ) : (
            <span class="rg-hint">{allRules.length ? 'No repository matches these rules yet.' : 'Add a rule to see which repositories it catches.'}</span>
          )}
        </div>

        <div><button type="button" class="rg-linkish" onClick={openInYaml}><Icon name="code" size={14} />Edit .github/repo-groups.yml</button></div>

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
