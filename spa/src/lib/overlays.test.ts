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

  it("ignores placement from outsiders", () => {
    const privileged = new Set([OWNER]);
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
    expect(resolvePlacementSlug([bad, good], ISSUE, privileged)).toBe("needs-richard");
  });
});
