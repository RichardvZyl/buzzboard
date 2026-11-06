// Per-card agent notification subscriptions.
// Stored on the card via status-event tags (same pattern as assignee/rank):
//   ["notify", <agent-slug>, <event>, <event>, ...]
// Newest status event that carries any notify tag wins (full replacement set).

import type { Column } from "./kinds.ts";
import type { SignedEvent } from "./nostr.ts";

export const NOTIFY_EVENTS = [
  "triage",
  "backlog",
  "in_progress",
  "in_review",
  "done",
  "closed",
  "assignee",
  "comment",
] as const;

export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

export interface NotifySubscription {
  agentSlug: string;
  events: NotifyEvent[];
}

export interface NotifyChange {
  type: NotifyEvent;
  cardId: string;
  subject: string;
  detail?: string;
  /** Event id that caused the change (status, comment, …). Used for dedupe. */
  triggeringEventId: string;
}

export interface NotifyDelivery {
  agentSlug: string;
  change: NotifyChange;
  dedupeKey: string;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const EVENT_SET = new Set<string>(NOTIFY_EVENTS);

export const isNotifyEvent = (v: string): v is NotifyEvent => EVENT_SET.has(v);

export const columnToNotifyEvent = (column: Column): NotifyEvent => column;

/** Stable dedupe key — one delivery per (card, agent, change-type, triggering event). */
export function dedupeKey(change: NotifyChange, agentSlug: string): string {
  return `${change.cardId}:${agentSlug}:${change.type}:${change.triggeringEventId}`;
}

/**
 * Parse subscriptions from status events that reference the issue.
 * The newest status (by created_at, then id) that has ≥1 `notify` tag defines the set.
 */
export function parseNotifySubscriptions(
  statuses: SignedEvent[],
  issueId: string,
): NotifySubscription[] {
  const referencing = statuses
    .filter((ev) => ev.tags.some((t) => t[0] === "e" && t[1] === issueId))
    .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1));

  const carrier = referencing.find((ev) => ev.tags.some((t) => t[0] === "notify"));
  if (!carrier) return [];

  const bySlug = new Map<string, Set<NotifyEvent>>();
  for (const t of carrier.tags) {
    if (t[0] !== "notify" || t.length < 3) continue;
    const slug = (t[1] || "").toLowerCase();
    if (!SLUG_RE.test(slug)) continue;
    let set = bySlug.get(slug);
    if (!set) {
      set = new Set();
      bySlug.set(slug, set);
    }
    for (const raw of t.slice(2)) {
      if (isNotifyEvent(raw)) set.add(raw);
    }
  }
  return [...bySlug.entries()]
    .map(([agentSlug, events]) => ({
      agentSlug,
      events: NOTIFY_EVENTS.filter((e) => events.has(e)),
    }))
    .filter((s) => s.events.length > 0)
    .sort((a, b) => a.agentSlug.localeCompare(b.agentSlug));
}

/** Encode subscriptions as status tags (one tag per agent). */
export function notifyTags(subs: NotifySubscription[]): string[][] {
  return subs
    .filter((s) => SLUG_RE.test(s.agentSlug) && s.events.length > 0)
    .map((s) => {
      const events = NOTIFY_EVENTS.filter((e) => s.events.includes(e));
      return ["notify", s.agentSlug.toLowerCase(), ...events];
    });
}

/** Which subscribed agents should be told about this change (no dedupe yet). */
export function matchingRecipients(
  subs: NotifySubscription[],
  change: NotifyChange,
): string[] {
  return subs
    .filter((s) => s.events.includes(change.type))
    .map((s) => s.agentSlug)
    .sort();
}

/** Build delivery records, skipping keys already in `alreadyDelivered`. */
export function planDeliveries(
  subs: NotifySubscription[],
  change: NotifyChange,
  alreadyDelivered: ReadonlySet<string>,
): NotifyDelivery[] {
  const out: NotifyDelivery[] = [];
  for (const agentSlug of matchingRecipients(subs, change)) {
    const key = dedupeKey(change, agentSlug);
    if (alreadyDelivered.has(key)) continue;
    out.push({ agentSlug, change, dedupeKey: key });
  }
  return out;
}

/** Merge/replace one agent's subscription in a list. Empty events removes them. */
export function upsertSubscription(
  subs: NotifySubscription[],
  agentSlug: string,
  events: NotifyEvent[],
): NotifySubscription[] {
  const slug = agentSlug.toLowerCase();
  const rest = subs.filter((s) => s.agentSlug !== slug);
  const cleaned = NOTIFY_EVENTS.filter((e) => events.includes(e));
  if (!cleaned.length) return rest;
  return [...rest, { agentSlug: slug, events: cleaned }].sort((a, b) =>
    a.agentSlug.localeCompare(b.agentSlug)
  );
}

export function formatNotifyMessage(change: NotifyChange, agentSlug: string): string {
  const detail = change.detail ? `\n${change.detail}` : "";
  return (
    `@${agentSlug} Buzz card notification: **${change.subject}**\n` +
    `- change: \`${change.type}\`\n` +
    `- issue: \`${change.cardId}\`` +
    detail
  );
}

/** Roster slugs agents can subscribe (Buzz identities / A2A peers). No secrets. */
export const NOTIFY_AGENT_SLUGS = [
  "cursor",
  "claude",
  "claude-haiku",
  "claude-sonnet",
  "claude-opus",
  "gemini",
  "gemini-flash",
  "gemini-pro",
  "cline",
  "cline-free",
  "devin",
  "grok",
  "hermes",
  "copilot",
  "jules",
  "agy",
  "delegation-bot",
  "engineering-lead",
  "qa-bot",
  "supervisor-bot",
  "projects-manager",
  "alfred",
  "product-manager",
  "design-bot",
  "senior-software-engineer",
  "richard",
] as const;

/** A2A delivery targets. delegation-bot uses its webhook peer; others go via front door. */
export interface A2ATarget {
  slug: string;
  /** Direct JSON-RPC when set; otherwise front door with this name in the message. */
  directJsonRpc?: string;
}

export const A2A_NOTIFY_TARGETS: Record<string, A2ATarget> = {
  "delegation-bot": {
    slug: "delegation-bot",
    directJsonRpc: "http://127.0.0.1:8122/jsonrpc",
  },
  cursor: { slug: "cursor" },
  claude: { slug: "claude" },
  "claude-haiku": { slug: "claude-haiku" },
  "claude-sonnet": { slug: "claude-sonnet" },
  "claude-opus": { slug: "claude-opus" },
  gemini: { slug: "gemini" },
  cline: { slug: "cline" },
  "cline-free": { slug: "cline-free" },
  devin: { slug: "devin" },
  grok: { slug: "grok" },
  hermes: { slug: "hermes" },
  copilot: { slug: "copilot" },
  jules: { slug: "jules" },
  agy: { slug: "agy" },
};
