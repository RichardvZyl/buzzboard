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

/** Resolve placement target lane; optional `a` tag must match slug when present. */
export function placementTargetLaneAddress(
  ev: SignedEvent,
  lanes: Lane[],
  targetSlug: string,
  nativeAddress: string,
): string | null {
  const slug = targetSlug.toLowerCase();
  const explicit = tagValue(ev, "a");
  if (explicit) {
    const lane = lanes.find((l) => l.address === explicit);
    if (!lane || lane.repoId.toLowerCase() !== slug) return null;
    return explicit;
  }
  return laneAddressBySlug(lanes, slug, nativeAddress);
}

/** Latest authorized placement slug for an issue, or null. */
export function resolvePlacementSlug(
  events: SignedEvent[],
  issueId: string,
  lanes: Lane[],
  nativeAddress: string,
): string | null {
  const nativeLane = lanes.find((l) => l.address === nativeAddress);
  const nativePrivileged = nativeLane ? privilegedPubkeys([nativeLane]) : new Set<string>();

  const ordered = events
    .filter((ev) => {
      if (!isPlacementEvent(ev)) return false;
      const pubkey = ev.pubkey.toLowerCase();

      const targetSlug = String(tagValue(ev, "l") || "").toLowerCase();

      // Native slug un-place — only privileges on the card's home lane
      if (nativeLane && targetSlug === nativeLane.repoId.toLowerCase()) {
        return nativePrivileged.has(pubkey);
      }

      const targetLaneAddress = placementTargetLaneAddress(ev, lanes, targetSlug, nativeAddress);
      if (!targetLaneAddress) return false;

      const targetLane = lanes.find((l) => l.address === targetLaneAddress);
      const targetPrivileged = targetLane ? privilegedPubkeys([targetLane]) : new Set<string>();

      return nativePrivileged.has(pubkey) && targetPrivileged.has(pubkey);
    })
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

/**
 * Map a lane repoId slug to an address. When several lanes share a repoId,
 * only resolve when nativeAddress disambiguates (same owner or exact native lane).
 */
export function laneAddressBySlug(
  lanes: Lane[],
  slug: string,
  nativeAddress?: string,
): string | null {
  const lower = slug.toLowerCase();
  const matches = lanes.filter((l) => l.repoId.toLowerCase() === lower);
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0].address;
  if (!nativeAddress) return null;

  const nativeOwner = nativeAddress.split(":")[1]?.toLowerCase();
  const sameOwner = matches.filter((l) => l.owner === nativeOwner);
  if (sameOwner.length === 1) return sameOwner[0].address;

  const nativeHit = matches.find((l) => l.address === nativeAddress);
  if (nativeHit) return nativeHit.address;

  return null;
}

export { tagValues };
