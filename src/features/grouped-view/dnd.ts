import type { Controller } from './controller';

/** Drag type of a repository row (A4). Plain text carries the name too, for drops outside the extension. */
export const DRAG_TYPE = 'application/x-rg-repo';
export const OVER = 'rg-drop-over';

const hasRepo = (e: DragEvent): boolean => !!e.dataTransfer && Array.from(e.dataTransfer.types ?? []).includes(DRAG_TYPE);

/** Clears every highlight: called when a drag ends anywhere. */
export const clearOver = (root: ParentNode = document) => root.querySelectorAll(`.${OVER}`).forEach((el) => el.classList.remove(OVER));

/** Props that make a repo row draggable. */
export function dragSource(repo: string) {
  return {
    draggable: true,
    onDragStart(e: DragEvent) {
      if (!e.dataTransfer) return;
      e.dataTransfer.setData(DRAG_TYPE, repo);
      e.dataTransfer.setData('text/plain', repo);
      e.dataTransfer.effectAllowed = 'move';
    },
    onDragEnd: () => clearOver(),
  };
}

/** Props that make a group row or sidebar item a drop target for `path` ([] = Ungrouped). Drops run `ctl.moveRepo`. */
export function dropTarget(ctl: Pick<Controller, 'moveRepo'>, path: string[]) {
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
      const repo = e.dataTransfer?.getData(DRAG_TYPE);
      if (repo) void ctl.moveRepo(repo, path);
    },
  };
}
