/** Presentation-only: which swimlanes are collapsed in this browser. */
export const COLLAPSED_LANES_KEY = "buzzboard.collapsedLanes";

export function readCollapsedLanes(
  storage: Pick<Storage, "getItem"> = localStorage,
): Set<string> {
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
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    storage.setItem(COLLAPSED_LANES_KEY, JSON.stringify([...lanes]));
  } catch {
    // Quota or private-mode failures must not break toggling.
  }
}
