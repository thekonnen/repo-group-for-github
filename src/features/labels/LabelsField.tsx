import { useState } from 'preact/hooks';
import { dueOn, labelKey, normColor, DEFAULT_LABEL_COLOR, type EffectiveLabel, type EffectiveMilestone } from '../../core/labels';
import type { LabelTag, MilestoneTag } from '../../core/types';
import { Icon } from '../../ui/Icon';

/**
 * "Default labels" and "Default milestones" of Edit group (C2). Own entries are edited here; the ones inherited from
 * ancestors are shown read-only and muted. Sync labels adds what is missing to the repositories; it never changes existing ones.
 */
export function LabelsField({
  labels,
  milestones,
  onLabels,
  onMilestones,
  inheritedLabels,
  inheritedMilestones,
  onSync,
  syncNote,
}: {
  labels: LabelTag[];
  milestones: MilestoneTag[];
  onLabels: (l: LabelTag[]) => void;
  onMilestones: (m: MilestoneTag[]) => void;
  inheritedLabels: (EffectiveLabel & { key: string })[];
  inheritedMilestones: (EffectiveMilestone & { key: string })[];
  onSync?: () => void;
  syncNote?: string | null;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [desc, setDesc] = useState('');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [mdesc, setMdesc] = useState('');
  const colorBad = !!color.trim() && !normColor(color);
  const dueBad = !!due.trim() && !dueOn(due);

  const addLabel = () => {
    const n = name.trim();
    if (!n || colorBad) return;
    const c = normColor(color);
    const next: LabelTag = { name: n, ...(c ? { color: c } : {}), ...(desc.trim() ? { description: desc.trim() } : {}) };
    onLabels([...labels.filter((l) => labelKey(l.name) !== labelKey(n)), next]);
    setName(''), setColor(''), setDesc('');
  };
  const addMilestone = () => {
    const t = title.trim();
    if (!t || dueBad) return;
    const next: MilestoneTag = { title: t, ...(due.trim() ? { due_on: due.trim() } : {}), ...(mdesc.trim() ? { description: mdesc.trim() } : {}) };
    onMilestones([...milestones.filter((m) => labelKey(m.title) !== labelKey(t)), next]);
    setTitle(''), setDue(''), setMdesc('');
  };
  const enter = (f: () => void) => (e: KeyboardEvent) => e.key === 'Enter' && (e.preventDefault(), f());

  return (
    <>
      <div class="rg-field" role="group" aria-labelledby="rg-f-labels-l">
        <label id="rg-f-labels-l">Default labels</label>
        <ul class="rg-llist" aria-label="Default labels of this group">
          {labels.map((l, i) => (
            <li class="rg-lrow" key={l.name}>
              <span class="rg-tchip"><i class="rg-swatch" style={{ background: `#${l.color ?? DEFAULT_LABEL_COLOR}` }} aria-hidden="true" />{l.name}</span>
              <span class="rg-muted rg-mono">{l.color ?? DEFAULT_LABEL_COLOR}{l.description ? ` · ${l.description}` : ''}</span>
              <button type="button" class="rg-btn rg-icon-btn" aria-label={`Remove label ${l.name}`} onClick={() => onLabels(labels.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>
            </li>
          ))}
          {inheritedLabels.map((e) => (
            <li class="rg-lrow rg-inh" key={`inh:${e.key}`}>
              <span class="rg-tchip rg-inh"><i class="rg-swatch" style={{ background: `#${e.label.color}` }} aria-hidden="true" />{e.label.name}</span>
              <span class="rg-muted">from {e.from}</span>
            </li>
          ))}
          {!labels.length && !inheritedLabels.length && <li class="rg-muted rg-lrow">No default labels yet.</li>}
        </ul>
        <div class="rg-add-rule">
          <input class="rg-input" value={name} placeholder="Label name" aria-label="Label name" autocomplete="off" onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={enter(addLabel)} />
          <input class="rg-input rg-mono" value={color} placeholder="d73a4a" aria-label="Label color" aria-invalid={colorBad ? 'true' : undefined} autocomplete="off" size={8} onInput={(e) => setColor((e.target as HTMLInputElement).value)} onKeyDown={enter(addLabel)} />
          <input class="rg-input" value={desc} placeholder="Description (optional)" aria-label="Label description" autocomplete="off" onInput={(e) => setDesc((e.target as HTMLInputElement).value)} onKeyDown={enter(addLabel)} />
          <button type="button" class="rg-btn" disabled={!name.trim() || colorBad} onClick={addLabel}>Add label</button>
        </div>
        {colorBad && <span class="rg-hint rg-error" role="alert">Color must be six hex digits, like d73a4a.</span>}
        <span class="rg-hint">Leave the color empty for GitHub’s default grey. Subgroups inherit these labels.</span>
      </div>

      <div class="rg-field" role="group" aria-labelledby="rg-f-ms-l">
        <label id="rg-f-ms-l">Default milestones</label>
        <ul class="rg-llist" aria-label="Default milestones of this group">
          {milestones.map((m, i) => (
            <li class="rg-lrow" key={m.title}>
              <span class="rg-tchip">{m.title}</span>
              <span class="rg-muted">{[m.due_on && `due ${m.due_on.slice(0, 10)}`, m.description].filter(Boolean).join(' · ')}</span>
              <button type="button" class="rg-btn rg-icon-btn" aria-label={`Remove milestone ${m.title}`} onClick={() => onMilestones(milestones.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>
            </li>
          ))}
          {inheritedMilestones.map((e) => (
            <li class="rg-lrow rg-inh" key={`inh:${e.key}`}>
              <span class="rg-tchip rg-inh">{e.milestone.title}</span>
              <span class="rg-muted">from {e.from}</span>
            </li>
          ))}
          {!milestones.length && !inheritedMilestones.length && <li class="rg-muted rg-lrow">No default milestones yet.</li>}
        </ul>
        <div class="rg-add-rule">
          <input class="rg-input" value={title} placeholder="Milestone title" aria-label="Milestone title" autocomplete="off" onInput={(e) => setTitle((e.target as HTMLInputElement).value)} onKeyDown={enter(addMilestone)} />
          <input class="rg-input rg-mono" value={due} placeholder="2026-12-31" aria-label="Milestone due date" aria-invalid={dueBad ? 'true' : undefined} autocomplete="off" size={10} onInput={(e) => setDue((e.target as HTMLInputElement).value)} onKeyDown={enter(addMilestone)} />
          <input class="rg-input" value={mdesc} placeholder="Description (optional)" aria-label="Milestone description" autocomplete="off" onInput={(e) => setMdesc((e.target as HTMLInputElement).value)} onKeyDown={enter(addMilestone)} />
          <button type="button" class="rg-btn" disabled={!title.trim() || dueBad} onClick={addMilestone}>Add milestone</button>
        </div>
        {dueBad && <span class="rg-hint rg-error" role="alert">Due date must look like 2026-12-31.</span>}
        <div class="rg-lrow-actions">
          {onSync && <button type="button" class="rg-btn" disabled={!!syncNote} onClick={onSync}>Sync labels</button>}
        </div>
        {syncNote && <span class="rg-hint">{syncNote}</span>}
        <span class="rg-hint">Sync labels only adds what a repository is missing. It never changes, recolors or deletes an existing label or milestone.</span>
      </div>
    </>
  );
}
