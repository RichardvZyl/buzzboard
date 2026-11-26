# Managed BuzzBoard commands

Live browser writes and the board CLI use the Agent-MCP command ingress at
`POST /board/commands` on the configured relay origin. Existing relay queries
and the in-memory demo retain their behavior. The relay must mount or proxy
this path to agent-tools-mcp before deploying this client. A missing ingress
fails the write. The browser never falls back to publishing raw events.

The request body contains:

| Field | Meaning |
|---|---|
| `version` | Protocol version, currently `1` |
| `requestId` | Caller-generated UUID, used for replay and retry correlation |
| `operation` | Command from the following table |
| `input` | Operation-specific JSON object |

Authenticate the request with NIP-98 signed over the exact URL and body.
Derive the actor from the signature. Accept a command only after authorization
and the operation's durable state change or explicitly reported pending state.
Return JSON `{"ok":true}`, with optional result data. Return a non-2xx status
with a descriptive error for rejection. Return a stable code and a concrete recovery step when available, using the fields `ok: false`, `code`, `error`, and `resolution`. Scope idempotency to authenticated
actor and request ID. Reusing an ID with a different payload must fail.
Never pass caller-supplied actor or GitHub visibility through as authority.

| Operation | Input |
|---|---|
| `lane.create` | name, description, agentPubkeys. The service creates a private repository |
| `lane.attachChannel`, `lane.delete` | lane, plus channelId for attach |
| `lane.linkCanvas` | channelId, boardUrl |
| `ticket.create` | lane, title, body, labels. Return ticketId and workspace provisioning state |
| `ticket.spinOff` | ticketId, lane, title, body, labels, closeOriginal |
| `ticket.setPurpose` | ticketId, title, body. Persist initial purpose commit SHA |
| `ticket.move` | ticketId, lane, column, before and after neighbor IDs when present |
| `ticket.assign` | ticketId, agentPubkey or null. Resolve through front-door routing |
| `ticket.dependencies` | ticketId, dependencies as complete list of full ticket IDs |
| `ticket.notifications`, `ticket.comment` | ticketId with subscriptions or body |
| `ticket.acknowledge` | ticketId, assignmentId, optional provider, model, effort, capabilities |
| `ticket.claim`, `ticket.resolve`, `ticket.close` | ticketId, optional note. Apply the same transition policy |
| `ticket.interrupt` | ticketId, assignmentId, reason, optional note |

Project title/context changes as authorized kind 1985 events with namespace
`buzz-board-purpose`, the original issue ID in the `e` tag, title in the
`subject` tag, and context in the event content. Preserve the issue ID.
Project dependencies using the existing `buzz-board-dependencies` namespace,
with the full current set in repeated `depends-on` tags. An empty set clears
the dependencies.

The CLI's generic operation accepts an input JSON file:

```powershell
node tools/buzz-board.mjs command --as <slug> --operation ticket.setPurpose --input purpose.json
```

For branch deletion, `archive-disposition.mjs` contains the pure decision rule.
The receiver must supply verified PR facts and exact commit membership, with
missing or indeterminate GitHub data represented as unknown. The workflow
sender signs the raw JSON payload over timestamp + "." + body. Verify before
processing and deduplicate by delivery or workflow run ID.

## Setup, imports and rollout

The legacy profile command invokes agent.profile with name and optional about.
The lane-create command invokes lane.create with name, optional slug and
description, and agentPubkeys. lane.maintainers accepts lane plus add/remove
public-key arrays. Maintainership dry runs remain local reads.

ticket.import accepts lane, fixtureId, tasks and dryRun. The service must
deduplicate rows atomically by lane, fixtureId and row identifier, including
across retries and concurrently running imports. Seed and reconcile that index from existing issue tags of the form `["fixture", fixtureId, String(row)]`. A replay of the legacy 11-row fixture must report 11 skips. Dry runs return a plan
without publishing. Apply the same repository and issue gates as creation.

Deploy the private build after verifying managed ingress and authentication. Neither repository publishes through GitHub Pages.

Lane repositories provide the delete trigger. The receiver verifies the
signature, GitHub PR/commit evidence, and ticket mapping before closing. Automatic archiving is inactive until the lane-side caller and receiver are deployed. Verify replay idempotency, exact default-branch reachability, and both merged and closed-unmerged PR cases before enabling it.
See the [agent guide](../AGENT-GUIDE.md) for agent recovery from rejected writes.
