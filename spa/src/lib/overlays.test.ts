import { describe, expect, it } from "vitest";
import {
  isArchiveLane,
  mergeLabels,
  resolvePlacementSlug,
  LABEL_NAMESPACE,
  PLACEMENT_NAMESPACE,
  KIND_LABEL,
} from "./overlays";
import type { Lane } from "./board";
import type { SignedEvent } from "./nostr";

const AUTHOR = "a".repeat(64);
const OWNER = "b".repeat(64);
const OUTSIDER = "c".repeat(64);
const ISSUE = "d".repeat(64);

function ev(partial: Partial<SignedEvent> & { tags: string[][]; pubkey: string; created_at: number }): SignedEvent {
  return {
    id: partial.id ?? `${partial.created_at}`.padStart(64, "0"),
    kind: partial.kind ?? KIND_LABEL,
    pubkey: partial.pubkey,
    created_at: partial.created_at,
    tags: partial.tags,
    content: partial.content ?? "add",
    sig: "00",
  };
}

describe("overlays", () => {
  it("detects archive lanes by slug or tags", () => {
    const base = {
      address: `30617:${OWNER}:x`,
      owner: OWNER,
      name: "X",
      description: "",
      channelId: null,
      githubUrl: null,
      syncAgent: null,
      maintainers: [],
      tags: [] as string[][],
    };
    expect(isArchiveLane({ ...base, repoId: "archive" } as Lane)).toBe(true);
    expect(isArchiveLane({ ...base, repoId: "a2a-work", tags: [["t", "buzz-archive"]] } as Lane)).toBe(true);
    expect(isArchiveLane({ ...base, repoId: "a2a-work" } as Lane)).toBe(false);
  });

  it("merges labels without treating placement as a label", () => {
    const actors = new Set([AUTHOR, OWNER]);
    const add = ev({
      pubkey: AUTHOR,
      created_at: 1,
      tags: [["L", LABEL_NAMESPACE], ["l", "blocked", LABEL_NAMESPACE], ["e", ISSUE]],
      content: "add",
    });
    const place = ev({
      pubkey: OWNER,
      created_at: 2,
      tags: [["L", PLACEMENT_NAMESPACE], ["l", "archive", PLACEMENT_NAMESPACE], ["e", ISSUE]],
      content: "archive",
    });
    expect(mergeLabels(["triage"], [add, place], ISSUE, actors).sort()).toEqual(["blocked", "triage"]);
  });

  it("ignores placement from outsiders and allows owners of both lanes", () => {
    const nativeLane = { address: "30617:b:a", owner: OWNER, maintainers: [], repoId: "a", tags: [] } as Lane;
    const targetLane = {
      address: "30617:b:needs-richard",
      owner: OWNER,
      maintainers: [],
      repoId: "needs-richard",
      tags: [],
    } as Lane;
    const lanes = [nativeLane, targetLane];

    const bad = ev({
      pubkey: OUTSIDER,
      created_at: 1,
      tags: [["L", PLACEMENT_NAMESPACE], ["l", "archive", PLACEMENT_NAMESPACE], ["e", ISSUE]],
      content: "archive",
    });
    const good = ev({
      pubkey: OWNER,
      created_at: 2,
      id: "2".padStart(64, "0"),
      tags: [["L", PLACEMENT_NAMESPACE], ["l", "needs-richard", PLACEMENT_NAMESPACE], ["e", ISSUE]],
      content: "move",
    });
    expect(resolvePlacementSlug([bad, good], ISSUE, lanes, nativeLane.address)).toBe("needs-richard");
  });

  it("maintainer of lane A cannot place into lane B", () => {
    const laneA = { address: "30617:x:a", owner: "x", maintainers: [OWNER], repoId: "a", tags: [] } as Lane;
    const laneB = { address: "30617:y:b", owner: "y", maintainers: [], repoId: "b", tags: [] } as Lane;
    const lanes = [laneA, laneB];

    const bad = ev({
      pubkey: OWNER,
      created_at: 1,
      tags: [["L", PLACEMENT_NAMESPACE], ["l", "b", PLACEMENT_NAMESPACE], ["e", ISSUE]],
      content: "move",
    });
    expect(resolvePlacementSlug([bad], ISSUE, lanes, laneA.address)).toBeNull();
  });
});
