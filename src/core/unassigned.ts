/** Repositories that sit in no group (A6). Pure: the index and placement already decide who is ungrouped. */

/** Ungrouped repositories the person has already been shown, per org (storage.local, with the time). */
export interface SeenUngrouped {
  names: string[];
  at: number;
}

/** Names in `current` that were not in the seen set. With no record yet (first visit) nothing is new, so a fresh install does not flag every repository. */
export function newUngrouped(prev: SeenUngrouped | null | undefined, current: readonly string[]): string[] {
  if (!prev) return [];
  const seen = new Set(prev.names);
  return current.filter((n) => !seen.has(n));
}

/** The seen record after a visit: exactly the repositories that are ungrouped now (the ones that got grouped drop out). */
export function markSeen(current: readonly string[], now: number): SeenUngrouped {
  return { names: [...new Set(current)], at: now };
}

export interface UnassignedVisit {
  /** Names flagged "New" in this page session (still ungrouped). */
  newNames: string[];
  /** What to store for the next visit. */
  seen: SeenUngrouped;
}

/** One visit: which repositories are new since the last one (keeping the ones already flagged), and the record to store. */
export function visitUngrouped(prev: SeenUngrouped | null | undefined, flagged: readonly string[], current: readonly string[], now: number): UnassignedVisit {
  const still = new Set(current);
  const newNames = [...new Set([...flagged, ...newUngrouped(prev, current)])].filter((n) => still.has(n));
  return { newNames, seen: markSeen(current, now) };
}
