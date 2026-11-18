/** Presentation-only: which swimlanes are collapsed in this browser. */
export const COLLAPSED_LANES_KEY = "buzzboard.collapsedLanes";

/**
 * Reading `localStorage` itself throws in some browsers (storage blocked, sandboxed
 * iframes), so the lookup lives inside a try rather than in a default-parameter expression
 * that would run outside the callers' catch blocks.
 */
function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readCollapsedLanes(
  storage: Pick<Storage, "getItem"> | null = defaultStorage(),
): Set<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(COLLAPSED_LANES_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

export function writeCollapsedLanes(
  lanes: ReadonlySet<string>,
  storage: Pick<Storage, "setItem"> | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(COLLAPSED_LANES_KEY, JSON.stringify([...lanes]));
  } catch {
    // Quota or private-mode failures must not break toggling.
  }
}