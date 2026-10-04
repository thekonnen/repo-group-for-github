import type { Controller } from './controller';

/** Drag type of a repository drag (A4). The payload is a JSON list of repo names. Plain text carries them too. */
export const DRAG_TYPE = 'application/x-rg-repo';
export const OVER = 'rg-drop-over';
export const COPY = 'rg-drop-copy';

const hasRepo = (e: DragEvent): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types ?? []).includes(DRAG_TYPE);

/** Clears every highlight: called when a drag ends anywhere. */
export const clearOver = (root: ParentNode = document) => root.querySelectorAll(`.${OVER}`).forEach((el) => el.classList.remove(OVER, COPY));

const parse = (raw: string | undefined): string[] => {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.filter((x) => typeof x === 'string');
  } catch {
    /* a bare name */
  }
  return [raw];
};

/**
 * Props for the drag handle of a repo row. Dragging the handle of a selected row drags every selected repository;
 * dragging an unselected row drags just that one.
 */
export function dragSource(getSelected: () => string[], repo: string) {
  return {
    draggable: true,
    onDragStart(e: DragEvent) {
      if (!e.dataTransfer) return;
      const sel = getSelected();
      const repos = sel.includes(repo) ? sel : [repo];
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(repos));
      e.dataTransfer.setData('text/plain', repos.join('\n'));
      e.dataTransfer.effectAllowed = 'copyMove'; // Alt/Option at the drop = "Also list in…" instead of a move
      const row = (e.currentTarget as HTMLElement | null)?.closest?.('.rg-row');
      if (row && e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(row, 16, 16);
    },
    onDragEnd: () => clearOver(),
  };
}

/**
 * Props that make a group row or sidebar item a drop target for `path` ([] = Ungrouped). A drop only stages the change:
 * a plain drop stages a move; with Alt/Option held (A3) it stages "Also list in…", which needs a real group.
 */
export function dropTarget(ctl: Pick<Controller, 'stageMove'> & Partial<Pick<Controller, 'stageShare'>>, path: string[]) {
  const mark = (e: DragEvent, el: HTMLElement) => {
    const copy = e.altKey && path.length > 0;
    el.classList.add(OVER);
    el.classList.toggle(COPY, copy);
    if (e.dataTransfer) e.dataTransfer.dropEffect = e.altKey ? (copy ? 'copy' : 'none') : 'move';
  };
  return {
    onDragEnter(e: DragEvent) {
      if (!hasRepo(e)) return;
      e.preventDefault();
      mark(e, e.currentTarget as HTMLElement);
    },
    onDragOver(e: DragEvent) {
      if (!hasRepo(e)) return;
      if (e.altKey && !path.length) return; // Ungrouped cannot "also list": no drop
      e.preventDefault(); // allows the drop
      mark(e, e.currentTarget as HTMLElement);
    },
    onDragLeave(e: DragEvent) {
      const el = e.currentTarget as HTMLElement;
      if (!(e.relatedTarget instanceof Node) || !el.contains(e.relatedTarget)) el.classList.remove(OVER, COPY);
    },
    onDrop(e: DragEvent) {
      if (!hasRepo(e)) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).classList.remove(OVER, COPY);
      const repos = parse(e.dataTransfer?.getData(DRAG_TYPE));
      if (!repos.length) return;
      if (e.altKey) {
        if (path.length) ctl.stageShare?.(repos, path);
      } else ctl.stageMove(repos, path);
    },
  };
}
