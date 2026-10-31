// NIP-32 kind 1985 overlays for card labels and board placement.
// Columns still come only from status events — these never move a card's column.
// Authorization here is announcement-based (lane owners + maintainers, plus
// author/assignee for labels). The CLI config role matrix and write-policy proxy
// are the strict gates; the SPA ignores overlays from everyone else.

import type { SignedEvent } from "./nostr.ts";
import type { Lane } from "./board.ts";

export const KIND_LABEL = 1985;
export const LABEL_NAMESPACE = "buzz-board";
export const PLACEMENT_NAMESPACE = "buzz-board-placement";

const tagValue = (ev: SignedEvent, name: string): string | undefined =>
  ev.tags.find((t) => t[0] === name && t.length >= 2)?.[1];

const tagValues = (ev: SignedEvent, name: string): string[] =>
  ev.tags.filter((t) => t[0] === name && t.length >= 2).map((t) => t[1]);

export function isArchiveLane(lane: Lane): boolean {
  if (lane.repoId.toLowerCase() === "archive") return true;
  const tags = lane.tags ?? [];
  if (tags.some((t) => t[0] === "t" && String(t[1]).toLowerCase() === "buzz-archive")) return true;
  if (tags.some((t) => t[0] === "hidden" && t[1] === "true")) return true;
  return false;
}

function isLabelEvent(ev: SignedEvent): boolean {
  return ev.kind === KIND_LABEL &&
    ev.tags.some((t) => t[0] === "L" && t[1] === LABEL_NAMESPACE) &&
    !!tagValue(ev, "l");
}

function isPlacementEvent(ev: SignedEvent): boolean {
  return ev.kind === KIND_LABEL &&
    ev.tags.some((t) => t[0] === "L" && t[1] === PLACEMENT_NAMESPACE) &&
    !!tagValue(ev, "l");
}

export function mergeLabels(
  issueLabels: string[],
  events: SignedEvent[],
  issueId: string,
  actors: Set<string>,
): string[] {
  const state = new Map<string, boolean>();
  for (const l of issueLabels) {
    const v = l.toLowerCase();
    if (v) state.set(v, true);
  }
  const ordered = events
    .filter((ev) => isLabelEvent(ev) && actors.has(ev.pubkey.toLowerCase()))
    .filter((ev) => ev.tags.some((t) => t[0] === "e" && t[1] === issueId))
    .sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
  for (const ev of ordered) {
    const name = String(tagValue(ev, "l") || "").toLowerCase();
    if (!name) continue;
    const op = String(ev.content || "add").trim().toLowerCase();
    if (op === "remove" || op === "-" || op === "delete") state.set(name, false);
    else state.set(name, true);
  }
  return [...state.entries()].filter(([, on]) => on).map(([n]) => n);
}

/** Latest authorized placement slug for an issue, or null. */
export function resolvePlacementSlug(
  events: SignedEvent[],
  issueId: string,
  privileged: Set<string>,
): string | null {
  const ordered = events
    .filter((ev) => isPlacementEvent(ev) && privileged.has(ev.pubkey.toLowerCase()))
    .filter((ev) => ev.tags.some((t) => t[0] === "e" && t[1] === issueId))
    .sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1));
  const last = ordered[ordered.length - 1];
  return last ? String(tagValue(last, "l") || "").toLowerCase() : null;
}

export function privilegedPubkeys(lanes: Lane[]): Set<string> {
  const s = new Set<string>();
  for (const lane of lanes) {
    s.add(lane.owner.toLowerCase());
    for (const m of lane.maintainers) s.add(m.toLowerCase());
  }
  return s;
}

export function laneAddressBySlug(lanes: Lane[], slug: string): string | null {
  const hit = lanes.find((l) => l.repoId.toLowerCase() === slug.toLowerCase());
  return hit?.address ?? null;
}

export { tagValues };
