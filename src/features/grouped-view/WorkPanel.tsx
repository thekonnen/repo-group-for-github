import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { WorkResult } from '../../background/work-items';
import { ago } from '../../core/time';
import {
  filterWork,
  labelText,
  mergeWork,
  nextDepth,
  reposWithMore,
  WORK_DEPTH_MAX,
  WORK_DEPTH_STEP,
  WORK_MAX_REPOS,
  WORK_PAGE,
  workCounts,
  type WorkItem,
  type WorkKind,
  type WorkMap,
} from '../../core/work-items';
import { Icon } from '../../ui/Icon';
import { CallError } from '../../github/client';

const KINDS: [WorkKind, string][] = [['all', 'All'], ['issue', 'Issues'], ['pr', 'Pull requests']];
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/**
 * C1: open issues and pull requests across the repositories of a group (subgroups included), newest update first.
 * `repos` are names from the user's own index. `load` asks the background (GraphQL aliases, cached for 5 minutes).
 */
export function WorkPanel({ org, name, repos, query, load }: { org: string; name: string; repos: string[]; query: string; load: (repos: string[], depth: number) => Promise<WorkResult> }) {
  const tooBig = repos.length > WORK_MAX_REPOS;
  const [map, setMap] = useState<WorkMap>({});
  const [depth, setDepth] = useState(WORK_DEPTH_STEP);
  const [shown, setShown] = useState(WORK_PAGE);
  const [kind, setKind] = useState<WorkKind>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState<number | null | undefined>(undefined);
  const run = useRef(0);
  const key = repos.join('\n');

  const fetchDepth = async (names: string[], d: number, merge: boolean) => {
    const id = merge ? run.current : ++run.current;
    setBusy(true);
    setError(null);
    try {
      const res = await load(names, d);
      if (id !== run.current) return; // the group changed meanwhile
      setMap((m) => (merge ? { ...m, ...res.repos } : res.repos));
      setDepth(d);
      setPaused(res.paused ? res.paused.resumeAt : undefined);
    } catch (e) {
      if (id === run.current) setError(e instanceof CallError || e instanceof Error ? e.message : String(e));
    } finally {
      if (id === run.current) setBusy(false);
    }
  };

  useEffect(() => {
    setMap({});
    setShown(WORK_PAGE);
    setDepth(WORK_DEPTH_STEP);
    setPaused(undefined);
    if (!tooBig && repos.length) void fetchDepth(repos, WORK_DEPTH_STEP, false);
    return () => void run.current++;
  }, [key]);

  const merged = useMemo(() => mergeWork(map), [map]);
  const items = useMemo(() => filterWork(merged.items, kind, query), [merged, kind, query]);
  const counts = useMemo(() => workCounts(merged.items), [merged]);
  const deeper = merged.incomplete ? nextDepth(depth) : null;
  const canMore = items.length > shown || deeper != null;

  const more = () => {
    setShown(shown + WORK_PAGE);
    // Rows already loaded cover the next page; otherwise fetch deeper for the repos that were cut.
    if (items.length < shown + WORK_PAGE && deeper != null) void fetchDepth(reposWithMore(map), deeper, true);
  };

  if (tooBig) {
    return (
      <div class="rg-box">
        <div class="rg-empty">
          <b>This group is too big to list its issues</b>
          {name} has {repos.length.toLocaleString()} repositories. Open a subgroup with {WORK_MAX_REPOS} repositories or fewer to see its open issues and pull requests.
        </div>
      </div>
    );
  }

  const resume = paused != null ? new Date(paused).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'later';
  return (
    <div class="rg-box">
      <div class="rg-box-head">
        <span>
          {plural(items.length, 'open item', 'open items')}
          {merged.incomplete && deeper == null && merged.hidden > 0 && <span class="rg-muted"> · newest {WORK_DEPTH_MAX} per repository</span>}
        </span>
        <div class="rg-view-seg rg-work-seg" role="group" aria-label="Show">
          {KINDS.map(([k, label]) => (
            <button type="button" key={k} class="rg-work-kind" aria-pressed={kind === k} onClick={() => (setKind(k), setShown(WORK_PAGE))}>
              {label}
              {!merged.incomplete && k !== 'all' && <> <span class="rg-counter">{k === 'issue' ? counts.issues : counts.prs}</span></>}
            </button>
          ))}
        </div>
      </div>
      {paused !== undefined && <div class="rg-banner rg-banner-warn" role="status">Paused to respect GitHub’s rate limit — resumes at {resume}. Showing what is cached.</div>}
      {error && <div class="rg-banner rg-banner-warn" role="alert">{error}</div>}
      {items.length ? (
        <div class="rg-rows">
          {items.slice(0, shown).map((i) => <WorkRow key={`${i.repo}#${i.number}`} org={org} item={i} />)}
        </div>
      ) : busy ? (
        <div class="rg-empty" role="status"><b>Loading issues and pull requests…</b></div>
      ) : (
        <div class="rg-empty"><b>{query.trim() ? 'Nothing matches' : 'No open issues or pull requests'}</b>{query.trim() ? 'Try a shorter search or another filter.' : `Nothing is open in ${name} right now.`}</div>
      )}
      {canMore && items.length > 0 && (
        <div class="rg-work-more">
          <button type="button" class="rg-btn" disabled={busy} onClick={more}>{busy ? 'Loading…' : 'Load more'}</button>
        </div>
      )}
    </div>
  );
}

function WorkRow({ org, item }: { org: string; item: WorkItem }) {
  const pr = item.kind === 'pr';
  return (
    <div class="rg-row rg-work-row">
      <span class={`rg-av rg-av-repo rg-work-ic ${pr ? 'rg-work-pr' : 'rg-work-issue'}`} title={pr ? (item.draft ? 'Draft pull request' : 'Pull request') : 'Issue'}>
        <Icon name={pr ? 'fork' : 'issue'} />
      </span>
      <div class="rg-row-main">
        <div class="rg-row-title">
          <a href={`https://github.com/${org}/${item.repo}`} class="rg-path-pre">{item.repo}</a>
          <a href={item.url}>{item.title}</a>
          {item.draft && <span class="rg-label">Draft</span>}
          {item.labels.map((l) => (
            <span class="rg-label rg-work-label" key={l.name} style={{ background: `#${l.color}`, color: labelText(l.color), borderColor: `#${l.color}` }}>{l.name}</span>
          ))}
        </div>
        <div class="rg-meta">
          <span>#{item.number}</span>
          {item.author && <span>by {item.author}</span>}
          <span>Updated {ago(item.updatedAt)}</span>
        </div>
      </div>
    </div>
  );
}
