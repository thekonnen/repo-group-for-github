import type { Controller } from './controller';

/** Drag type of a repository drag (A4). The payload is a JSON list of repo names. Plain text carries them too. */
export const DRAG_TYPE = 'application/x-rg-repo';
export const OVER = 'rg-drop-over';

const hasRepo = (e: DragEvent): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types ?? []).includes(DRAG_TYPE);

/** Clears every highlight: called when a drag ends anywhere. */
export const clearOver = (root: ParentNode = document) => root.querySelectorAll(`.${OVER}`).forEach((el) => el.classList.remove(OVER));

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
      e.dataTransfer.effectAllowed = 'move';
      const row = (e.currentTarget as HTMLElement | null)?.closest?.('.rg-row');
      if (row && e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(row, 16, 16);
    },
    onDragEnd: () => clearOver(),
  };
}

/** Props that make a group row or sidebar item a drop target for `path` ([] = Ungrouped). A drop only stages the move. */
export function dropTarget(ctl: Pick<Controller, 'stageMove'>, path: string[]) {
  return {
    onDragEnter(e: DragEvent) {
      if (!hasRepo(e)) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).classList.add(OVER);
    },
    onDragOver(e: DragEvent) {
      if (!hasRepo(e)) return;
      e.preventDefault(); // allows the drop
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      (e.currentTarget as HTMLElement).classList.add(OVER);
    },
    onDragLeave(e: DragEvent) {
      const el = e.currentTarget as HTMLElement;
      if (!(e.relatedTarget instanceof Node) || !el.contains(e.relatedTarget)) el.classList.remove(OVER);
    },
    onDrop(e: DragEvent) {
      if (!hasRepo(e)) return;
      e.preventDefault();
      (e.currentTarget as HTMLElement).classList.remove(OVER);
      const repos = parse(e.dataTransfer?.getData(DRAG_TYPE));
      if (repos.length) ctl.stageMove(repos, path);
    },
  };
}
