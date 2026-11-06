import { describe, expect, it } from "vitest";
import type { SignedEvent } from "./nostr.ts";
import {
  columnToNotifyEvent,
  dedupeKey,
  formatNotifyMessage,
  matchingRecipients,
  notifyTags,
  parseNotifySubscriptions,
  planDeliveries,
  upsertSubscription,
  type NotifyChange,
  type NotifySubscription,
} from "./notify.ts";

let seq = 0;
const nextId = () => (++seq).toString(16).padStart(64, "0");

function ev(
  kind: number,
  created_at: number,
  tags: string[][],
  content = "",
): SignedEvent {
  return {
    id: nextId(),
    kind,
    pubkey: "a".repeat(64),
    created_at,
    tags,
    content,
    sig: "0".repeat(128),
  } as SignedEvent;
}

const ISSUE = "1".repeat(64);

describe("notify tags round-trip", () => {
  it("encodes and parses subscriptions from the newest carrier status", () => {
    const subs: NotifySubscription[] = [
      { agentSlug: "cursor", events: ["in_progress", "done", "assignee"] },
      // events are normalised to NOTIFY_EVENTS order on parse
      { agentSlug: "delegation-bot", events: ["closed", "comment"] },
    ];
    const older = ev(1630, 10, [
      ["e", ISSUE, "", "root"],
      ["notify", "grok", "triage"],
    ]);
    const newer = ev(1630, 20, [["e", ISSUE, "", "root"], ...notifyTags(subs)]);
    const parsed = parseNotifySubscriptions([older, newer], ISSUE);
    expect(parsed).toEqual(subs);
  });

  it("ignores malformed slugs and unknown events", () => {
    const carrier = ev(1630, 5, [
      ["e", ISSUE, "", "root"],
      ["notify", "BAD SLUG", "done"],
      ["notify", "cursor", "done", "nope", "assignee"],
    ]);
    expect(parseNotifySubscriptions([carrier], ISSUE)).toEqual([
      { agentSlug: "cursor", events: ["done", "assignee"] },
    ]);
  });

  it("returns empty when no notify tags", () => {
    const s = ev(1630, 1, [["e", ISSUE, "", "root"], ["assignee", "b".repeat(64)]]);
    expect(parseNotifySubscriptions([s], ISSUE)).toEqual([]);
  });
});

describe("matching and dedupe", () => {
  const subs: NotifySubscription[] = [
    { agentSlug: "cursor", events: ["in_progress", "assignee"] },
    { agentSlug: "delegation-bot", events: ["in_progress", "comment"] },
    { agentSlug: "grok", events: ["closed"] },
  ];
  const change: NotifyChange = {
    type: "in_progress",
    cardId: ISSUE,
    subject: "Ship notify",
    triggeringEventId: "e".repeat(64),
  };

  it("matches only subscribed agents for the change type", () => {
    expect(matchingRecipients(subs, change)).toEqual(["cursor", "delegation-bot"]);
    expect(matchingRecipients(subs, { ...change, type: "closed" })).toEqual(["grok"]);
  });

  it("plans deliveries once; second plan with recorded keys is empty", () => {
    const first = planDeliveries(subs, change, new Set());
    expect(first.map((d) => d.agentSlug)).toEqual(["cursor", "delegation-bot"]);
    const keys = new Set(first.map((d) => d.dedupeKey));
    expect(planDeliveries(subs, change, keys)).toEqual([]);
    // different triggering event → new deliveries
    const again = planDeliveries(
      subs,
      { ...change, triggeringEventId: "f".repeat(64) },
      keys,
    );
    expect(again).toHaveLength(2);
  });

  it("dedupeKey is stable and distinct per agent", () => {
    expect(dedupeKey(change, "cursor")).not.toEqual(dedupeKey(change, "delegation-bot"));
    expect(dedupeKey(change, "cursor")).toEqual(
      `${ISSUE}:cursor:in_progress:${change.triggeringEventId}`,
    );
  });
});

describe("upsertSubscription", () => {
  it("adds, replaces, and removes", () => {
    let subs: NotifySubscription[] = [];
    subs = upsertSubscription(subs, "Cursor", ["done"]);
    expect(subs).toEqual([{ agentSlug: "cursor", events: ["done"] }]);
    subs = upsertSubscription(subs, "cursor", ["done", "comment"]);
    expect(subs[0].events).toEqual(["done", "comment"]);
    subs = upsertSubscription(subs, "cursor", []);
    expect(subs).toEqual([]);
  });
});

describe("helpers", () => {
  it("maps columns and formats messages", () => {
    expect(columnToNotifyEvent("in_review")).toBe("in_review");
    const msg = formatNotifyMessage(
      {
        type: "assignee",
        cardId: ISSUE,
        subject: "X",
        detail: "- note: hi",
        triggeringEventId: "e".repeat(64),
      },
      "cursor",
    );
    expect(msg).toContain("@cursor");
    expect(msg).toContain("`assignee`");
    expect(msg).toContain(ISSUE);
    expect(msg).toContain("- note: hi");
  });
});
