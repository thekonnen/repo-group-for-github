import { useEffect, useRef, useState } from 'preact/hooks';
import { langColor } from '../../core/lang-colors';
import { displayName } from '../../core/edit';
import { detailTotals, DETAILS_MAX_REPOS } from '../../core/details';
import { ago } from '../../core/time';
import { allRepos, flatRows, searchRows, SORT_KEYS, SORT_LABEL, treeRows, VIRTUALIZE_AFTER, windowRange, type GroupNode, type Row, type SortKey, type TreeModel } from '../../core/tree';
import type { RepoInfo } from '../../core/types';
import { GroupAvatar } from '../logos/GroupAvatar';
import { Icon } from '../../ui/Icon';
import { useStore } from '../store';
import { chipTeams } from '../../core/teams';
import { TeamBanners } from '../teams/TeamBanners';
import { TeamChips } from '../teams/TeamChips';
import type { Controller, State } from './controller';

const ROW_H = 76;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const repoUrl = (org: string, name: string) => `https://github.com/${org}/${name}`;

export function GroupedView({ ctl }: { ctl: Controller }) {
  const s = useStore(ctl.store);
  if (s.view === 'list') return <ListBanner ctl={ctl} />;
  if (s.phase === 'signed-out') return <SignInEmpty ctl={ctl} s={s} />;
  const model = ctl.model();
  if (!model) return <div class="rg-view"><div class="rg-empty"><b>Loading repositories…</b></div></div>;
  return <Groups ctl={ctl} s={s} model={model} />;
}

function ListBanner({ ctl }: { ctl: Controller }) {
  return (
    <div class="rg-banner" role="status">
      <span class="rg-grow">This is GitHub’s default list. Repository Group can show it grouped.</span>
      <button type="button" class="rg-btn" onClick={() => ctl.setView('grouped')}>
        <Icon name="folder" />Show grouped
      </button>
    </div>
  );
}

function SignInEmpty({ ctl, s }: { ctl: Controller; s: State }) {
  const f = s.signIn;
  return (
    <div class="rg-view">
      <div class="rg-box">
        <div class="rg-empty">
          <b>Group your repositories</b>
          Repository Group for Github organizes {s.org}’s repositories into groups and subgroups. Sign in with GitHub to start.
          {f && !f.error ? (
            <div style="margin:16px auto 0;max-width:280px;display:flex;flex-direction:column;gap:8px">
              <span class="rg-muted">Enter this code on GitHub:</span>
              <code class="rg-code" aria-live="polite">{f.userCode}</code>
              <button type="button" class="rg-btn rg-btn-primary" onClick={() => ctl.openVerification(f)}>Open GitHub</button>
              <span class="rg-muted">Waiting for you to authorize…</span>
            </div>
          ) : (
            <div style="margin-top:16px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
              <button type="button" class="rg-btn rg-btn-primary" onClick={() => ctl.startSignIn()}>Sign in with GitHub</button>
              <button type="button" class="rg-btn" onClick={() => ctl.setView('list')}>Use GitHub’s list</button>
            </div>
          )}
          {f?.error && <p class="rg-error" role="alert">{f.error}</p>}
        </div>
      </div>
    </div>
  );
}

function Groups({ ctl, s, model }: { ctl: Controller; s: State; model: TreeModel }) {
  const node = (s.path.length && model.byKey.get(s.path.join('/'))) || model.root;
  const isRoot = node === model.root;
  const team = ctl.teams.team; // F12: team repositories page
  const name = isRoot ? ctl.teams.label ?? s.org : displayName(node.group);
  const ungrouped = model.root.repos;
  const cfg = s.config;

  useSlashFocus();
  const scope = node.total <= DETAILS_MAX_REPOS ? allRepos(node) : [];
  const scopeKey = scope.map((r) => r.name).join('\n');
  useEffect(() => {
    if (s.phase === 'ready' && scope.length) void ctl.ensureDetails(scope.map((r) => r.name));
  }, [scopeKey, s.phase]);
  const split = detailTotals(scope, s.details);

  const tab = s.tab === 'rules' && isRoot ? 'items' : s.tab === 'ungrouped' && !isRoot ? 'items' : s.tab;
  let rows: Row[];
  let head: preact.ComponentChild;
  if (s.query.trim()) {
    // In the "All repositories" tab a search stays a flat list in the chosen order, like GitHub's own.
    rows = tab === 'all' ? flatRows(node, s.sort, s.query) : searchRows(model, node, s.query);
    head = `${plural(rows.length, 'result', 'results')} for “${s.query.trim()}”`;
  } else if (tab === 'all') {
    rows = flatRows(node, s.sort);
    head = plural(rows.length, 'repository', 'repositories');
  } else if (tab === 'ungrouped') {
    rows = ungrouped.map((repo) => ({ kind: 'repo' as const, repo, depth: 0 }));
    head = <>{plural(ungrouped.length, 'ungrouped repository', 'ungrouped repositories')} <span class="rg-muted">· no group rule matches these yet</span></>;
  } else {
    rows = treeRows(node, s.expanded, 0, ctl.orderOf);
    const kids = node.children.length;
    head = isRoot ? (
      <>{plural(kids, 'group', 'groups')} <span class="rg-muted">· {ungrouped.length} ungrouped</span></>
    ) : (
      `${plural(kids, 'subgroup', 'subgroups')}, ${plural(node.repos.length, 'repository', 'repositories')}`
    );
  }

  return (
    <div class="rg-view">
      <IndexStatus ctl={ctl} s={s} model={model} />
      {s.error && (
        <div class="rg-banner rg-banner-warn" role="alert">
          <span class="rg-grow"><b>{s.error.message}</b>{s.error.hint ? ` ${s.error.hint}` : ''}</span>
        </div>
      )}
      {cfg && !cfg.exists && (
        <div class="rg-banner" role="status">
          <span class="rg-grow">No groups yet: <code>{s.org}/.github</code> has no <code>repo-groups.yml</code>, so every repository is shown as ungrouped.</span>
          {s.access?.canWriteOrg && (
            <>
              <button type="button" class="rg-btn" onClick={() => ctl.openDrawer('new', [])}><Icon name="folder" />Create groups</button>
              <button type="button" class="rg-btn" onClick={() => ctl.openYaml()}><Icon name="sparkle" />Start with AI</button>
            </>
          )}
        </div>
      )}
      {cfg && cfg.exists && cfg.error && (
        <div class="rg-banner rg-banner-warn" role="alert"><span class="rg-grow"><b>repo-groups.yml has a problem:</b> {cfg.error}. Showing every repository as ungrouped.</span></div>
      )}
      <TeamBanners ctl={ctl} />
      <Crumbs ctl={ctl} s={s} model={model} node={node} />
      <Header ctl={ctl} s={s} node={node} name={name} isRoot={isRoot} />
      <div class="rg-stats">
        <Stat label="Repositories" value={node.total.toLocaleString()} />
        <Stat label={isRoot ? 'Groups' : 'Subgroups'} value={node.subgroups.toLocaleString()} />
        {split ? (
          <>
            <Stat label="Open issues" value={split.issues.toLocaleString()} />
            <Stat label="Open pull requests" value={split.prs.toLocaleString()} />
          </>
        ) : (
          <Stat label="Open issues & PRs" value={node.issues.toLocaleString()} />
        )}
        <Stat label="Last push" value={ago(node.latest)} />
      </div>
      <div class="rg-tabs" role="tablist">
        <Tab ctl={ctl} id="items" current={tab} label="Groups and repositories" />
        {isRoot ? <Tab ctl={ctl} id="ungrouped" current={tab} label="Ungrouped" count={ungrouped.length} /> : <Tab ctl={ctl} id="rules" current={tab} label="Match rules" count={node.group.match.length} />}
        <Tab ctl={ctl} id="all" current={tab} label="All repositories" count={node.total} />
      </div>
      {tab === 'rules' && !s.query ? (
        <RulesPanel node={node} />
      ) : (
        <>
          <Toolbar ctl={ctl} s={s} placeholder={`Search in ${name}`} />
          <div class="rg-box">
            <div class="rg-box-head"><span>{head}</span>{tab === 'all' ? <SortSelect value={s.sort} label="Sort repositories" onChange={(k) => ctl.setSort(k)} /> : tab === 'items' && !isRoot && !s.query.trim() ? <SortSelect group value={ctl.sortOf(node)} label={`Sort the repositories of ${name}`} onChange={(k) => void ctl.setGroupSort(node, k)} /> : <span class="rg-muted">Sort: Last pushed</span>}</div>
            {rows.length ? <Rows ctl={ctl} s={s} rows={rows} /> : <Empty tab={tab} query={s.query} isRoot={isRoot} team={team} />}
          </div>
        </>
      )}
    </div>
  );
}

function Empty({ tab, query, isRoot, team }: { tab: string; query: string; isRoot: boolean; team?: string }) {
  if (team && isRoot && !query.trim()) return <div class="rg-empty"><b>No repositories yet</b>{team} cannot access any repository. Use Sync access to give it the access set in repo-groups.yml.</div>;
  if (query.trim()) return <div class="rg-empty"><b>No repositories match</b>Try a shorter name or clear the search.</div>;
  if (tab === 'ungrouped') return <div class="rg-empty"><b>Every repository is in a group</b>New repositories land here until a rule matches them.</div>;
  return <div class="rg-empty"><b>{isRoot ? 'No repositories yet' : 'This group is empty'}</b>{isRoot ? 'Repositories you can access will show here.' : 'Add a match rule or create a subgroup.'}</div>;
}

function IndexStatus({ ctl, s, model }: { ctl: Controller; s: State; model: TreeModel }) {
  const r = s.refresh;
  if (r.state === 'running' && (!s.meta || r.progress)) {
    const p = r.progress;
    return (
      <div class="rg-status" role="status" aria-live="polite">
        {p?.phase === 'action' ? <>Loading the organization index…<span class="rg-bar"><i style={{ width: `${Math.min(100, p.loaded)}%` }} /></span></> : p ? <>Indexing {p.loaded.toLocaleString()} of about {p.estimatedTotal.toLocaleString()} repositories…<span class="rg-bar"><i style={{ width: `${Math.min(100, (p.loaded / p.estimatedTotal) * 100)}%` }} /></span></> : 'Loading repositories…'}
      </div>
    );
  }
  if (r.state === 'paused') {
    const at = r.resumeAt ? new Date(r.resumeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'later';
    return <div class="rg-status" role="status">Paused to respect GitHub’s rate limit — resumes at {at}</div>;
  }
  return (
    <div class="rg-status" role="status">
      <span>{plural(model.visible, 'repository', 'repositories')}</span>
      {s.meta && <span>· updated {ctl.updatedText(s.meta)}</span>}
      <span>·</span>
      <button type="button" class="rg-linkish" onClick={() => ctl.refresh(true)}>Re-index</button>
    </div>
  );
}

function Crumbs({ ctl, s, model, node }: { ctl: Controller; s: State; model: TreeModel; node: GroupNode }) {
  const chain = [{ key: '', path: [] as string[], label: ctl.teams.label ?? s.org, slug: ctl.teams.team ?? s.org, root: true }, ...node.path.map((_, i) => { const k = node.path.slice(0, i + 1).join('/'); const g = model.byKey.get(k)?.group; return { key: k, path: node.path.slice(0, i + 1), label: g ? displayName(g) : node.path[i], slug: node.path[i], root: false }; })];
  const logoOf = (key: string) => model.byKey.get(key)?.group.logo;
  return (
    <nav class="rg-crumbs" aria-label="Group path">
      {chain.map((c, i) => (
        <>
          {i > 0 && <span aria-hidden="true">/</span>}
          {i === chain.length - 1 ? (
            <span class="rg-cur" style="display:inline-flex;gap:6px;align-items:center"><GroupAvatar logos={ctl.logos} name={c.slug} label={c.label} logo={logoOf(c.key)} cls="rg-mini-av" root={c.root} />{c.label}</span>
          ) : (
            <a href={`#${c.path.join('/')}`} onClick={(e) => (e.preventDefault(), ctl.go(c.path))}><GroupAvatar logos={ctl.logos} name={c.slug} label={c.label} logo={logoOf(c.key)} cls="rg-mini-av" root={c.root} />{c.label}</a>
          )}
        </>
      ))}
    </nav>
  );
}

function Header({ ctl, s, node, name, isRoot }: { ctl: Controller; s: State; node: GroupNode; name: string; isRoot: boolean }) {
  const team = ctl.teams.team;
  const canEdit = !!s.access?.canWriteOrg && !team; // members without write access get suggest mode later (F15); the team page is a read-only view
  const cfg = s.config;
  const chips = cfg && cfg.exists && cfg.config ? chipTeams(cfg.config.groups, node.path) : [];
  const q = node.path.length ? `?rg_group=${encodeURIComponent(node.key)}` : '';
  return (
    <div class="rg-g-head">
      <div class="rg-g-title">
        {canEdit && !isRoot ? (
          <button type="button" class="rg-big-av-btn" aria-label={`Edit logo of ${name}`} title="Edit logo" onClick={() => ctl.openDrawer('edit', node.path, 'logo')}>
            <GroupAvatar logos={ctl.logos} name={node.group.name} label={name} logo={node.group.logo} cls="rg-big-av" />
            <span class="rg-pen"><Icon name="pencil" size={12} /></span>
          </button>
        ) : (
          <GroupAvatar logos={ctl.logos} name={isRoot ? name : node.group.name} label={name} logo={node.group.logo} cls="rg-big-av" root={isRoot} />
        )}
        <div style="min-width:0"><h1>{name}</h1><p>{isRoot && team ? `Repositories this team can access, in the groups of ${s.org}` : node.group.description}</p>{!isRoot && <TeamChips org={s.org} teams={chips} active={team} onSync={(slug) => void ctl.teams.openSync({ teams: [slug], groupKey: node.key })} />}</div>
      </div>
      <div class="rg-g-actions">
        {canEdit && <button type="button" class="rg-btn" onClick={() => ctl.openYaml()}><Icon name="code" />Edit YAML</button>}
        {canEdit && !isRoot && <button type="button" class="rg-btn" onClick={() => ctl.openDrawer('edit', node.path)}><Icon name="pencil" />Edit group</button>}
        {canEdit && <button type="button" class="rg-btn" onClick={() => ctl.openDrawer('new', node.path)}><Icon name="folder" />{isRoot ? 'New group' : 'New subgroup'}</button>}
        {!team && <a class="rg-btn rg-btn-primary" href={s.access?.personal ? `https://github.com/new?owner=${encodeURIComponent(s.org)}${q ? '&' + q.slice(1) : ''}` : `https://github.com/organizations/${s.org}/repositories/new${q}`}>New repository</a>}
      </div>
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => <div class="rg-stat"><span>{label}</span><b>{value}</b></div>;

function SortSelect({ value, label, onChange, group }: { value: SortKey; label: string; onChange: (k: SortKey) => void; group?: boolean }) {
  return (
    <label class="rg-muted rg-sort">
      Sort:{' '}
      <select class={group ? "rg-sort-select" : "rg-y-scope"} aria-label={label} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value as SortKey)}>
        {SORT_KEYS.map((k) => <option value={k} selected={k === value}>{SORT_LABEL[k]}</option>)}
      </select>
    </label>
  );
}

function Tab({ ctl, id, current, label, count }: { ctl: Controller; id: State['tab']; current: string; label: string; count?: number }) {
  return (
    <button type="button" role="tab" class="rg-tab" aria-selected={current === id} onClick={() => ctl.setTab(id)}>
      {label}{count != null && <> <span class="rg-counter">{count}</span></>}
    </button>
  );
}

function Toolbar({ ctl, s, placeholder }: { ctl: Controller; s: State; placeholder: string }) {
  const [text, setText] = useState(s.query);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => setText(s.query), [s.query]);
  const onInput = (v: string) => {
    setText(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => ctl.setQuery(v), 100); // search runs in memory, 100 ms debounce
  };
  return (
    <div class="rg-toolbar">
      <label class="rg-search">
        <Icon name="search" />
        <input id="rg-search" type="search" placeholder={placeholder} aria-label={placeholder} value={text} onInput={(e) => onInput((e.target as HTMLInputElement).value)} />
      </label>
      <div class="rg-view-seg" role="group" aria-label="View">
        <button type="button" title="Grouped view" aria-pressed={s.view === 'grouped'} onClick={() => ctl.setView('grouped')}><Icon name="folder" /></button>
        <button type="button" title="GitHub list view" aria-pressed={false} onClick={() => ctl.setView('list')}><Icon name="list" /></button>
      </div>
    </div>
  );
}

/** "/" focuses the search unless the user is typing in a field; it wins over GitHub's own shortcut. */
function useSlashFocus() {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = (e.composedPath?.()[0] ?? e.target) as HTMLElement | null; // composedPath sees through shadow roots
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const input = document.getElementById('rg-search') as HTMLInputElement | null;
      if (!input) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      input.focus();
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);
}

/** Plain list, or a simple window when it is longer than 100 rows (no library). */
function Rows({ ctl, s, rows }: { ctl: Controller; s: State; rows: Row[] }) {
  const virtual = rows.length > VIRTUALIZE_AFTER;
  const ref = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: 30 });
  useEffect(() => {
    if (!virtual) return;
    let raf = 0;
    const calc = () => {
      raf = 0;
      const top = ref.current?.getBoundingClientRect().top ?? 0;
      setRange(windowRange(-top, window.innerHeight, ROW_H, rows.length));
    };
    const on = () => raf || (raf = requestAnimationFrame(calc));
    calc();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => {
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
      cancelAnimationFrame(raf);
    };
  }, [virtual, rows.length]);
  const slice = virtual ? rows.slice(range.start, range.end) : rows;
  const model = ctl.model();
  const canPin = ctl.canEditOrder() && !ctl.teams.team;
  /** Pin state of a repo in the group that holds it (primary placement). Ungrouped repos have no group to pin in. */
  const pinOf = (name: string): PinInfo | undefined => {
    const key = model?.placed.get(name);
    const g = key ? model?.byKey.get(key) : undefined;
    if (!g || !key) return undefined;
    return { key, group: displayName(g.group), pinned: g.pins.some((p) => p.toLowerCase() === name.toLowerCase()), can: canPin };
  };
  return (
    <div class="rg-rows" ref={ref} style={virtual ? { paddingTop: range.start * ROW_H, paddingBottom: Math.max(0, rows.length - range.end) * ROW_H } : undefined}>
      {slice.map((r) => (r.kind === 'group' ? <GroupRow key={`g:${r.node.key}`} ctl={ctl} row={r} fixed={virtual} /> : <RepoRow key={`r:${r.repo.name}`} ctl={ctl} org={s.org} row={r} fixed={virtual} label={ctl.teams.repoLabel(r.repo.name)} pin={pinOf(r.repo.name)} />))}
    </div>
  );
}

function GroupRow({ ctl, row, fixed }: { ctl: Controller; row: Extract<Row, { kind: 'group' }>; fixed: boolean }) {
  const { node, open, depth } = row;
  const cfg = ctl.store.get().config;
  const chips = cfg && cfg.exists && cfg.config ? chipTeams(cfg.config.groups, node.path) : [];
  const n = node.total;
  const sub = node.subgroups;
  return (
    <div class={`rg-row${fixed ? ' rg-fixed' : ''}`} style={{ '--rg-depth': depth } as any}>
      <button type="button" class="rg-chev" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${displayName(node.group)}`} onClick={() => ctl.toggleGroup(node.key)}><Icon name="chev" /></button>
      <GroupAvatar logos={ctl.logos} name={node.group.name} label={displayName(node.group)} logo={node.group.logo} cls="rg-av" />
      <div class="rg-row-main">
        <div class="rg-row-title">
          <a href={`#${node.key}`} class="rg-grp" onClick={(e) => (e.preventDefault(), ctl.go(node.path))}>{displayName(node.group)}</a>
          <span class="rg-label">Group</span>
        </div>
        {node.group.description && <p class="rg-desc">{node.group.description}</p>}
        {chips.length > 0 && <div class="rg-row-teams"><TeamChips org={ctl.store.get().org} teams={chips} active={ctl.teams.team} /></div>}
        <div class="rg-meta">
          <span><Icon name="repo" size={14} />{plural(n, 'repository', 'repositories')}</span>
          {sub > 0 && <span><Icon name="folder" size={14} />{plural(sub, 'subgroup', 'subgroups')}</span>}
          <span>{node.latest ? `Updated ${ago(node.latest)}` : 'No pushes yet'}</span>
        </div>
      </div>
      <div class="rg-row-side"><span class="rg-rules-line" title={node.group.match.join(', ')}>Rules: {node.group.match.length ? node.group.match.join(', ') : '—'}</span></div>
    </div>
  );
}

/** `label` is the team's permission on the team page; otherwise the label shows Public or Private. */
interface PinInfo {
  key: string;
  group: string;
  pinned: boolean;
  can: boolean;
}

/** "⋯" menu of a repo row: Pin to top of <group> / Unpin (C5). Only shown to people who can write the org file. */
function RepoMenu({ ctl, name, pin }: { ctl: Controller; name: string; pin: PinInfo }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => !box.current?.contains((e.composedPath?.()[0] ?? e.target) as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (setOpen(false), box.current?.querySelector('button')?.focus());
    document.addEventListener('mousedown', away, true);
    document.addEventListener('keydown', esc, true);
    return () => (document.removeEventListener('mousedown', away, true), document.removeEventListener('keydown', esc, true));
  }, [open]);
  return (
    <div class="rg-menu" ref={box}>
      <button type="button" class="rg-btn rg-icon-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`More actions for ${name}`} onClick={() => setOpen(!open)}>
        <Icon name="kebab" />
      </button>
      {open && (
        <div class="rg-menu-list" role="menu">
          <button type="button" role="menuitem" autofocus onClick={() => (setOpen(false), void ctl.setPin(pin.key, name, !pin.pinned))}>
            <Icon name="pin" size={14} />{pin.pinned ? 'Unpin' : `Pin to top of ${pin.group}`}
          </button>
        </div>
      )}
    </div>
  );
}

function RepoRow({ ctl, org, row, fixed, label, pin }: { ctl: Controller; org: string; row: Extract<Row, { kind: 'repo' }>; fixed: boolean; label?: string; pin?: PinInfo }) {
  const r: RepoInfo = row.repo;
  return (
    <div class={`rg-row${fixed ? ' rg-fixed' : ''}`} style={{ '--rg-depth': row.depth } as any}>
      <span class="rg-chev-sp" />
      <span class="rg-av rg-av-repo"><Icon name="repo" /></span>
      <div class="rg-row-main">
        <div class="rg-row-title">
          {pin?.pinned && <span class="rg-pin" title={`Pinned in ${pin.group}`} role="img" aria-label={`Pinned in ${pin.group}`}><Icon name="pin" size={14} /></span>}
          <a href={repoUrl(org, r.name)}>{row.prefix && <span class="rg-path-pre">{row.prefix}</span>}{r.name}</a>
          <span class="rg-label">{label ?? (r.private ? 'Private' : 'Public')}</span>
          {r.fork && <span class="rg-label">Fork</span>}
        </div>
        {r.description && <p class="rg-desc">{r.description}</p>}
        <div class="rg-meta">
          {r.language && <span><i class="rg-lang-dot" style={{ background: langColor(r.language, r.languageColor) }} />{r.language}</span>}
          <span title="Forks"><Icon name="fork" size={14} />{r.forks ?? 0}</span>
          <span title="Stars"><Icon name="star" size={14} />{r.stars ?? 0}</span>
          <span title="Open issues and pull requests"><Icon name="issue" size={14} />{r.openIssuesAndPrs ?? 0}</span>
          <span>Updated {ago(r.pushedAt)}</span>
        </div>
      </div>
      {pin?.can && <RepoMenu ctl={ctl} name={r.name} pin={pin} />}
    </div>
  );
}

function RulesPanel({ node }: { node: GroupNode }) {
  const own = node.repos;
  return (
    <div class="rg-box">
      <div class="rg-box-head"><span>How repositories join <code>{node.key}</code></span></div>
      <div class="rg-rules">
        <div class="rg-chips">
          {node.group.match.length ? node.group.match.map((m) => <span class="rg-chip rg-ro" key={m}>{m}</span>) : <span class="rg-muted">No rules. Repositories only appear here through subgroups.</span>}
        </div>
        <p class="rg-desc">Patterns use <code>*</code> as a wildcard and are checked against the repository name. An exact name always wins; when several patterns match, the deepest group wins. New repositories are placed automatically on the next visit.</p>
        <div>
          <b>Matched directly here</b>
          <div class="rg-chips" style="margin-top:8px">
            {own.length ? own.map((r) => <span class="rg-chip rg-ro" key={r.name}>{r.name}</span>) : <span class="rg-muted">No repository matches these rules yet.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

export { allRepos };
