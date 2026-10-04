/** Order of the group page tabs: the saved ids that are still visible, then the visible ones the person never placed. */
export function orderTabs(visible: string[], saved: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of [...saved, ...visible]) {
    if (visible.includes(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/** Moves `id` just before `beforeId`, or to the end when `beforeId` is null. Unknown ids leave the order as it is. */
export function moveTab(order: string[], id: string, beforeId: string | null): string[] {
  if (!order.includes(id) || id === beforeId) return order;
  const rest = order.filter((x) => x !== id);
  const at = beforeId === null ? rest.length : rest.indexOf(beforeId);
  if (at < 0) return order;
  rest.splice(at, 0, id);
  return rest;
}

/** One step left (-1) or right (+1). */
export function nudgeTab(order: string[], id: string, step: -1 | 1): string[] {
  const i = order.indexOf(id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const next = order.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
