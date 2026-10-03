import { render } from 'preact';
import tokensCss from '../../styles/tokens-page.css?inline';
import groupedCss from '../../styles/grouped.css?inline';
import newRepoCss from '../../styles/new-repo.css?inline';
import { call } from '../../github/client';
import type { Call } from '../../github/client';
import { waitFor } from '../../github/navigation';
import { findCreateButton, findOwnerLogin, locateNewRepo, readRepoName } from '../../github/selectors';
import { filedMessage } from '../../core/newrepo';
import type { FiledResult } from '../../background/new-repo';
import { createNewRepoController } from './controller';
import { GroupField } from './GroupField';

export interface Disposable {
  key: string;
  root: HTMLElement;
  dispose(): void;
}

const STYLE_ID = 'rg-style-nr';
let warned = false;

function ensureStyle(doc: Document) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = tokensCss + '\n' + groupedCss + '\n' + newRepoCss;
  doc.head.appendChild(style);
}

export interface NewRepoEnv {
  call: Call;
  location: Pick<Location, 'search'>;
}

/**
 * Injects the Group block right below the Description counter of "Create a new repository" (F9). It never blocks or
 * delays GitHub's form: on submit it only tells the background which group was chosen. If the Description field
 * cannot be found, nothing is injected.
 */
export async function mountNewRepo(urlOrg: string | null, env?: Partial<NewRepoEnv>, doc: Document = document, timeoutMs = 8000): Promise<Disposable | null> {
  const found = await waitFor(() => locateNewRepo(doc), timeoutMs, doc);
  if (!found) {
    if (!warned) console.debug('[RG] could not find the Description field of the new repository page; leaving it as is');
    warned = true;
    return null;
  }
  const e: NewRepoEnv = { call, location: window.location, ...env };
  ensureStyle(doc);

  const params = new URLSearchParams(e.location.search);
  const ctl = createNewRepoController({ call: e.call, presetGroup: params.get('rg_group') ?? undefined });

  const host = doc.createElement('div');
  host.className = 'rg-root rg-nr-host';
  host.dataset.rg = 'new-repo';
  host.hidden = true;
  found.after.after(host);
  render(<GroupField ctl={ctl} />, host);
  const unsub = ctl.store.subscribe(() => (host.hidden = ctl.store.get().phase !== 'ready'));

  const resolveOrg = () => urlOrg ?? params.get('owner') ?? findOwnerLogin(doc);
  const refresh = () => {
    void ctl.setOrg(resolveOrg());
    ctl.setName(readRepoName(found));
  };

  // A fresh page load means an earlier submit that left us here had failed: forget it.
  void e.call({ type: 'newrepo:discard' }).catch(() => undefined);
  refresh();

  // Name, owner and GitHub's own suggestions can change without an input event, so also look after clicks and keys.
  const scope: EventTarget = found.form ?? doc;
  const later = () => setTimeout(refresh, 0);
  const submit = () => {
    refresh();
    const entry = ctl.pendingEntry();
    if (entry) void e.call({ type: 'newrepo:pending', entry }).catch(() => undefined); // fire and forget, GitHub's form goes on
  };
  const create = findCreateButton(doc);
  const bound: [EventTarget, string, EventListener, boolean?][] = [
    [scope, 'click', later],
    [scope, 'keyup', later],
    [scope, 'change', later],
    [scope, 'input', later],
    [scope, 'focusout', later],
    [scope, 'submit', submit, true],
  ];
  if (create) bound.push([create, 'click', submit, true]);
  for (const [t, n, f, c] of bound) t.addEventListener(n, f, c);

  return {
    key: `new-repo:${urlOrg ?? ''}`,
    root: host,
    dispose() {
      for (const [t, n, f, c] of bound) t.removeEventListener(n, f, c);
      unsub();
      render(null, host);
      host.remove();
    },
  };
}

/**
 * The browser is on https://github.com/<org>/<repo>: if that repo was just created through the form, the
 * background files it (adds the name to the chosen group) and we show a small toast.
 */
export async function mountRepoToast(org: string, repo: string, env?: Partial<NewRepoEnv>, doc: Document = document, ttlMs = 8000): Promise<Disposable | null> {
  const c = env?.call ?? call;
  let res: FiledResult | null = null;
  try {
    res = await c<FiledResult | null>({ type: 'newrepo:landed', org, repo });
  } catch (err) {
    console.debug('[RG] could not file the new repository', err);
    return null;
  }
  if (!res) return null;
  ensureStyle(doc);
  const root = doc.createElement('div');
  root.className = 'rg-root';
  root.dataset.rg = 'repo-toast';
  const failed = !!res.error;
  const text = failed ? `Created ${org}/${repo}, but repo-groups.yml was not updated. ${res.error}` : filedMessage({ groupKey: res.groupKey, committed: res.committed, groupLabel: res.groupLabel });
  render(
    <div class={`rg-toast${failed ? ' rg-err' : ''}`} role="status">
      <span>{text}</span>
    </div>,
    root,
  );
  doc.body.appendChild(root);
  const timer = setTimeout(() => dispose(), ttlMs);
  const dispose = () => {
    clearTimeout(timer);
    render(null, root);
    root.remove();
  };
  return { key: `repo:${org}/${repo}`, root, dispose };
}
