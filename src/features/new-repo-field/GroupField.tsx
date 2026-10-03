import { useEffect, useRef, useState } from 'preact/hooks';
import { pathLabel, type Destination } from '../../core/newrepo';
import { findGroup } from '../../core/placement';
import type { Group } from '../../core/types';
import { Avatar } from '../../ui/Avatar';
import { Icon } from '../../ui/Icon';
import { useStore } from '../store';
import type { NrController, Suggestion } from './controller';

const AUTO = '';

/** The sentence under the path; same text as destinationSentence() with code and bold. */
function Sentence({ d, groups }: { d: Destination; groups: Group[] }) {
  switch (d.kind) {
    case 'empty':
      return <>Type a name to see which group it lands in.</>;
    case 'auto-hit':
      return <>Lands here because it matches the rule <code>{d.rule}</code>. Pick another group to override.</>;
    case 'auto-miss':
      return <>No rule matches this name yet, so it will show under Ungrouped. Pick a group to file it now.</>;
    case 'same':
      return <>Already matches the rule <code>{d.rule}</code> of this group. repo-groups.yml stays the same.</>;
    case 'diff':
      return <>Adds <code>{d.name}</code> to the match list of <b>{pathLabel(d.pickedKey, groups)}</b> in repo-groups.yml (otherwise it would land in {d.autoKey ? pathLabel(d.autoKey, groups) : 'Ungrouped'}).</>;
  }
}

const METHOD_LABEL = { keywords: 'Keywords', llm: 'AI' } as const;

/** One line about the last Keywords/AI request. */
function methodNote(sg: Suggestion, groups: Group[]): string {
  const who = METHOD_LABEL[sg.method];
  switch (sg.status) {
    case 'loading':
      return sg.method === 'llm' ? 'Asking the AI…' : 'Scoring the name…';
    case 'found':
      return `${sg.created ? 'Created and filed' : `${who}${sg.auto ? ' (by default)' : ''} filed it`} in ${pathLabel(sg.key!, groups)}${sg.model ? ` (${sg.model})` : ''}. Pick another group to override.`;
    case 'none':
      return `${who} is not sure about this name.${sg.method === 'keywords' ? ' Try AI, or pick a group.' : ' Pick a group.'}`;
    case 'error':
      return sg.message ?? `${who} failed.`;
    default:
      return ''; // 'new' and 'creating' are shown by <Proposal>
  }
}

/**
 * The AI found no group that fits and proposes a new one. The path is shown large; one button per level accepts
 * exactly that far (only the top group, group/subgroup, group/subgroup/subgroup) and files the repo there.
 */
function Proposal({ ctl, sg, groups }: { ctl: NrController; sg: Suggestion; groups: Group[] }) {
  const ng = sg.newGroup!;
  const busy = sg.status === 'creating';
  const last = ng.path.length - 1;
  const exists = (i: number) => !!findGroup(groups, ng.path.slice(0, i + 1));
  const labelAt = (i: number) => ng.titles.slice(0, i + 1).join(' / ');
  return (
    <div class="rg-proposal" id="rg-nr-proposal" role="group" aria-label="Suggested new group">
      <div class="rg-prop-head">
        <Icon name="sparkle" size={14} />
        <b>AI suggests a new group</b>
        {sg.model && <span class="rg-muted">({sg.model})</span>}
      </div>
      <div class="rg-prop-path">
        {ng.titles.map((t, i) => (
          <>
            {i > 0 && <span class="rg-prop-sep" aria-hidden="true">/</span>}
            <span class={'rg-prop-seg' + (i === last ? ' rg-last' : '')}>
              <Avatar key={'p' + i} name={ng.path[i]} label={t} cls="rg-mini-av" />
              {t}
              {exists(i) && <em class="rg-prop-exists">exists</em>}
            </span>
          </>
        ))}
      </div>
      {ng.descriptions[last] && <div class="rg-prop-desc">{ng.descriptions[last]}</div>}
      <div class="rg-prop-choose" role="group" aria-label="How far to create">
        <span class="rg-hint">{ng.path.length > 1 ? 'Accept up to:' : 'Accept:'}</span>
        {ng.path.map((_, i) => (
          <button
            type="button"
            key={i}
            class={'rg-create-group' + (i === last ? ' rg-rec' : '')}
            data-depth={i + 1}
            disabled={busy}
            title={exists(i) ? 'This group already exists: just file the repository in it' : 'Create this group in repo-groups.yml and file the repository in it'}
            onClick={() => void ctl.createSuggestedGroup(i + 1)}
          >
            {busy && sg.chosenDepth === i + 1 ? 'Creating…' : `${exists(i) ? 'Use' : 'Create'} “${labelAt(i)}”`}
          </button>
        ))}
      </div>
      <span class="rg-hint">Creating a group commits to repo-groups.yml right away.</span>
    </div>
  );
}

/**
 * "Classify by" pills (below the destination). Rules is the automatic result and just reflects it; Keywords and AI run on click
 * and pick the group they find. The lit pill is the method behind the group that is selected now.
 */
function Methods({ ctl }: { ctl: NrController }) {
  const s = useStore(ctl.store);
  const d = ctl.destination();
  if (!s.canWrite || !d.name) return null;
  const sg = s.suggestion;
  const viaSuggestion = !!sg && sg.status === 'found' && sg.key === s.pickedKey;
  const rulesOn = !viaSuggestion && s.pickedKey === '' && d.kind === 'auto-hit';
  const busy = sg?.status === 'loading' || sg?.status === 'creating';
  const pill = (id: 'rules' | 'keywords' | 'llm', label: string, on: boolean, props: { disabled?: boolean; title: string; onClick: () => void; icon?: boolean }) => (
    <button type="button" class={'rg-pill' + (on ? ' rg-on' : '')} data-method={id} aria-pressed={on} disabled={props.disabled} title={props.title} onClick={props.onClick}>
      {props.icon && <Icon name="sparkle" size={12} />}
      {label}
    </button>
  );
  return (
    <div class="rg-nr-methods" id="rg-nr-methods">
      <div class="rg-pills" role="group" aria-label="Classify by">
        <span class="rg-hint">Classify by</span>
        {pill('rules', 'Rules', rulesOn, {
          disabled: !d.autoKey || rulesOn,
          title: d.autoKey ? 'Use the group the match rules choose' : 'No match rule catches this name',
          onClick: () => ctl.pick(''),
        })}
        {pill('keywords', 'Keywords', viaSuggestion && sg!.method === 'keywords', {
          disabled: busy,
          title: 'Compare the name with each group\'s title, description, keywords and rules (runs in your browser)',
          onClick: () => void ctl.classify('keywords'),
        })}
        {pill('llm', busy && sg!.method === 'llm' ? 'AI…' : 'AI', viaSuggestion && sg!.method === 'llm', {
          icon: true,
          disabled: busy,
          title: s.llmReady ? 'Ask the AI which group fits (sends the name and the group list to the provider)' : 'Needs an API key: extension Options > AI assistant',
          onClick: () => void ctl.classify('llm'),
        })}
      </div>
      {sg && (sg.status === 'new' || sg.status === 'creating') ? (
        <Proposal ctl={ctl} sg={sg} groups={s.groups} />
      ) : (
        sg && (
          <span class={'rg-hint rg-nr-method-note' + (sg.status === 'error' ? ' rg-warn' : '')} role="status" aria-live="polite">
            {methodNote(sg, s.groups)}
          </span>
        )
      )}
    </div>
  );
}

export const ExtTag = () => (
  <span class="rg-ext-tag">
    <i />
    Repository Group
  </span>
);

/** Group block of "Create a new repository" (F9). The Teams block (F12) goes directly below it, as a sibling component. */
export function GroupField({ ctl }: { ctl: NrController }) {
  const s = useStore(ctl.store);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  if (s.phase !== 'ready') return null;

  const d = ctl.destination();
  const opts = ctl.options();
  const keys = [AUTO, ...opts.map((o) => o.key)];
  const name = d.name || 'new-repository';
  const chain = d.destKey ? d.destKey.split('/') : [];
  const chainLabels = d.destKey ? pathLabel(d.destKey, s.groups).split(' / ') : [];

  return (
    <div class="rg-nr" id="rg-nr-group" data-rg="new-repo-group">
      <div class="rg-inject">
        <div class="rg-inject-head">
          <label id="rg-nr-label" for="rg-nr-picker">Group</label>
          <ExtTag />
        </div>
        {s.canWrite ? (
          <Picker ctl={ctl} open={open} setOpen={setOpen} active={active} setActive={setActive} keys={keys} btn={btn} list={list} />
        ) : (
          <span class="rg-hint" id="rg-nr-note">
            Org groups are read-only for you, so this repository is filed by the match rules of {s.org}/.github. You can organize it in My groups afterwards.
          </span>
        )}
        <div class="rg-nr-dest" id="rg-nr-dest" aria-live="polite">
          <div class="rg-dest-path">
            <Avatar name={s.org ?? ''} cls="rg-mini-av" root />
            {s.org}
            {chain.map((c, i) => (
              <>
                <span aria-hidden="true">/</span>
                <Avatar key={'a' + i} name={c} label={chainLabels[i]} cls="rg-mini-av" />
                {chainLabels[i]}
              </>
            ))}
            <span aria-hidden="true">/</span>
            <b>{name}</b>
          </div>
          {d.kind === 'auto-miss' ? (
            <div class="rg-nr-warn" id="rg-nr-ungrouped" role="status">
              <Icon name="alert" size={16} />
              <span>
                <b>Not in any group yet.</b> <Sentence d={d} groups={s.groups} />
              </span>
            </div>
          ) : (
            <span class="rg-hint">
              <Sentence d={d} groups={s.groups} />
            </span>
          )}
        </div>
        <Methods ctl={ctl} />
      </div>
    </div>
  );
}

interface PickerProps {
  ctl: NrController;
  open: boolean;
  setOpen: (v: boolean) => void;
  active: number;
  setActive: (n: number) => void;
  keys: string[];
  btn: { current: HTMLButtonElement | null };
  list: { current: HTMLUListElement | null };
}

function Picker({ ctl, open, setOpen, active, setActive, keys, btn, list }: PickerProps) {
  const s = ctl.store.get();
  const d = ctl.destination();
  const opts = ctl.options();
  const optId = (k: string) => `rg-opt-${k === AUTO ? 'auto' : k.replace(/[^\w-]/g, '_')}`;

  // Automatic with a rule hit: that group is where the repo lands, so it is the one marked (and focused) when the list opens.
  const autoPick = s.pickedKey === AUTO && d.kind === 'auto-hit' ? d.autoKey : '';
  const opened = useRef(false);
  const show = () => {
    setActive(Math.max(0, keys.indexOf(autoPick || s.pickedKey)));
    opened.current = true;
    setOpen(true);
  };
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };
  const choose = (k: string) => {
    ctl.pick(k);
    close(true);
  };

  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const away = (e: Event) => {
      const t = e.target as Node;
      if (!list.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', away, true);
    return () => document.removeEventListener('mousedown', away, true);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    // Right after opening, bring the current group to the middle of the list; while moving with the arrows, just keep it visible.
    list.current?.querySelector('.rg-active')?.scrollIntoView?.({ block: opened.current ? 'center' : 'nearest' });
    opened.current = false;
  }, [open, active]);

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      show();
    }
  };
  const onListKey = (e: KeyboardEvent) => {
    const last = keys.length - 1;
    const stop = () => (e.preventDefault(), e.stopPropagation());
    if (e.key === 'ArrowDown') (stop(), setActive(Math.min(last, active + 1)));
    else if (e.key === 'ArrowUp') (stop(), setActive(Math.max(0, active - 1)));
    else if (e.key === 'Home') (stop(), setActive(0));
    else if (e.key === 'End') (stop(), setActive(last));
    else if (e.key === 'Enter' || e.key === ' ') (stop(), choose(keys[active]));
    else if (e.key === 'Escape') (stop(), close(true));
    else if (e.key === 'Tab') close(false);
  };

  const picked = s.pickedKey ? opts.find((o) => o.key === s.pickedKey) : null;
  const auto = d.autoKey ? pathLabel(d.autoKey, s.groups) : null;
  return (
    <div class="rg-picker-wrap">
      <button
        type="button"
        class="rg-picker"
        id="rg-nr-picker"
        ref={btn}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="rg-nr-pop"
        aria-labelledby="rg-nr-label rg-nr-picker-lbl"
        onClick={() => (open ? close(false) : show())}
        onKeyDown={onButtonKey}
      >
        <span class="rg-lbl" id="rg-nr-picker-lbl">
          {picked ? (
            <span class="rg-lbl-in">
              <Avatar name={picked.name} label={picked.label} cls="rg-mini-av" />
              {pathLabel(picked.key, s.groups)}
            </span>
          ) : (
            <span class="rg-lbl-in">
              <Icon name="sparkle" />
              Automatic{auto && <span class="rg-muted"> → {auto}</span>}
            </span>
          )}
        </span>
        <span class="rg-caret"><Icon name="chev" /></span>
      </button>
      <ul
        class="rg-pop"
        id="rg-nr-pop"
        role="listbox"
        aria-labelledby="rg-nr-label"
        tabIndex={-1}
        hidden={!open}
        ref={list}
        aria-activedescendant={open ? optId(keys[active]) : undefined}
        onKeyDown={onListKey}
      >
        <li
          role="option"
          id={optId(AUTO)}
          class={active === 0 ? 'rg-active' : ''}
          aria-selected={s.pickedKey === AUTO}
          onMouseMove={() => setActive(0)}
          onClick={() => choose(AUTO)}
        >
          <span class="rg-tick">{s.pickedKey === AUTO && <Icon name="check" />}</span>
          <Icon name="sparkle" />
          <span>
            Automatic <span class="rg-muted">· by match rules</span>
          </span>
        </li>
        <li class="rg-sep" role="presentation" />
        {opts.map((o, i) => (
          <li
            role="option"
            key={o.key}
            id={optId(o.key)}
            class={[active === i + 1 ? 'rg-active' : '', o.key === autoPick ? 'rg-auto-pick' : ''].filter(Boolean).join(' ')}
            aria-selected={s.pickedKey === o.key}
            aria-current={o.key === autoPick ? 'true' : undefined}
            style={{ paddingLeft: `${8 + o.depth * 18}px` }}
            onMouseMove={() => setActive(i + 1)}
            onClick={() => choose(o.key)}
          >
            <span class="rg-tick">{(s.pickedKey === o.key || o.key === autoPick) && <Icon name="check" />}</span>
            <Avatar name={o.name} label={o.label} cls="rg-mini-av" />
            <span>{o.label}</span>
            {o.key === autoPick && d.rule && <span class="rg-auto-rule">matched by <code>{d.rule}</code></span>}
            <span class="rg-count">{o.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
