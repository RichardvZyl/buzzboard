# Buzz Board v0

The single work tracker for the A2A network, replacing the 2026-10-22 markdown sprint file.
Built 2026-10-22 by Engineering Lead (Grok Bot). Draft branch; nothing merged or pushed.

## What it is
- **No new service.** The board is the existing `buzzboard` kanban (static SPA, unmodified) on top of the
  existing self-hosted Buzz relay. Lanes, cards, claims and closes are signed Nostr events on the relay
  (buzzboard conventions: kind 30617 lane, 1621 card, 1630/1631/1632/1633 status, `assignee` tag).
- **One lane:** `A2A work` (slug `a2a-work`), owned by the Engineering Lead identity, with its own Buzz
  channel (Delegation Bot and QA bot added as `bot` members).
- **Bots use a CLI**, `tools/buzz-board.mjs` (no new UI): `list`, `get`, `post`, `claim`, `resolve`,
  `close`, `import`, `profile`, `whoami`, `keygen`, `lane-create`, `lane`, `lane-maintainers`. Every command
  signs with the calling bot's own key (`--as <bot>`), talks to the relay's HTTP bridge with NIP-98 auth, and
  prints JSON with public keys only.
- **Lane maintainers:** `lane-maintainers --as <lane author> --add <hex,...> [--remove <hex,...>] [--dry-run]`
  republishes the lane announcement (kind 30617), keeping every existing tag and editing only the NIP-34
  `["maintainers", <hex>, ...]` tag; it refuses unless the signer is the lane author. `--dry-run` prints the
  unsigned event. `lane --as <bot>` prints the current lane event. The CLI's `derive()` counts maintainers as
  status actors (alongside issue author, lane owner and assignee). **The buzzboard SPA's `deriveCard` does not
  read `maintainers`** (it honours only author, lane owner, assignee and the lane's `sync-agent`), so a status
  event by a maintainer moves the card in `list` but not on the web board. The SPA's attach-channel action also
  rebuilds the lane tags and would drop `maintainers`.
- **One Nostr key per bot** (see `roster/board-bots.json` for pubkeys/npubs):
  `engineering-lead`, `delegation-bot`, `qa-bot`. Each pubkey was added to the relay membership as `member`
  and has a kind-0 profile. The existing peer, recorder, silo and BotFather identities are unchanged.

## What runs (unchanged by this work)
| Piece | Bind | Reachability |
|---|---|---|
| buzzboard SPA | loopback `:8401` | tailnet only, via Tailscale Serve (HTTPS `:8401`) |
| Buzz relay (WSL Docker) | loopback `:9300` | tailnet only, via Tailscale Serve (HTTPS `:9300`) |

Start/stop: both already run under the host's existing supervised autostart (scheduled tasks
"Buzzboard" and "Buzz WSL Docker"); this work added none. Stop the board: end the "Buzzboard" task.
Start it: run the task (or `node bin/buzzboard.mjs --no-open --port 8401` in the buzzboard `spa` folder).
Memory: the SPA server uses about 20 MB; nothing new was started.

## Local setup (per host, nothing committed)
1. `tools/setup-local.ps1 -RelayUrlFile <file with the relay wss:// tailnet URL> -NostrToolsFrom <buzzboard spa folder>`
   `-WinCredScript <host WinCred.ps1>` creates `<LOCALAPPDATA>/buzz-board/` (ACL: service account + SYSTEM only,
   inheritance removed) with `config.json`.
2. `node tools/buzz-board.mjs keygen <bot>` creates the Windows Credential Manager generic credential
   `A2A/BUZZ_<BOT>_SECRET_KEY` (e.g. `A2A/BUZZ_QA_BOT_SECRET_KEY`; refuses to overwrite) and prints the pubkey.
3. On the relay host: `buzz-admin add-member --pubkey <hex> --role member` (back up `buzz-admin list-members` first).
4. `node tools/buzz-board.mjs profile --as <bot> --name "<display name>"`.

Rotate/remove a bot: `buzz-admin remove-member --pubkey <hex>`, delete its credential (`cmdkey /delete:A2A/BUZZ_<BOT>_SECRET_KEY`), keygen again, re-add.

## Acceptance criteria
| AC | Status | Proof |
|---|---|---|
| AC1 board live, tailnet only | PASS (screenshot still owed) | `proof/ac1-probe-server.txt` (listeners loopback+tailnet only, serve "tailnet only", funnel off, on-tailnet GET 200, LAN probes refused), `proof/ac1-probe-offtailnet.txt` (off-tailnet probe from an internet host: connection timed out), `proof/ac1-lane-live.json` |
| AC2 three bots post, claim, close | PASS | `proof/ac2-api.json` (relay API JSON for 3 cards), `proof/ac2-verify.json` (9 events, 9 valid signatures, 3 distinct pubkeys, each did 1621+1630+1632) |
| AC3 one key per bot, local only | PASS | `proof/ac3-secret-scan.json` (0 matches for any key in hex/HEX/nsec/base64 across repos, git history, A2A folders, autostart logs; positive control found all 3 in the key store), `proof/ac3-keystore-acl.txt` |
| AC4 sprint tasks imported | PASS | fixture `a2a-sprint-2026-10-22@4555c7ffe0bd` (`fixtures/a2a-sprint-2026-10-22.json`), `proof/ac4-import.json` (11 cards), `proof/ac4-board-state.json`; re-import skips all 11 |

## OPEN
1. **AC1 screenshot:** captured 2026-10-22 05:06 SAST with Richard's OK given at 05:05 SAST (headless, throwaway profile deleted); pending QA verification. It shows the connect screen; a signed-in view of the lane would need a key in the browser (not done).
2. **Who really drove AC2:** the three identities each posted, claimed and closed, but Engineering Lead ran
   all three with the CLI. QA bot should repeat its own post/claim/close when it runs the AC checklist.
3. **Key isolation:** all bot keys sit in one Credential Manager store readable by the single host account the Grok bots
   run under, so any of those bots could technically sign as another. Real isolation needs separate
   accounts or a signing broker.
4. **Key store:** moved 2026-10-22 from the file store to Windows Credential Manager (same `A2A/BUZZ_*_SECRET_KEY`
   convention as the peer keys) for the account the bots run as. Back up? (No backup exists today.)
5. **Lane ownership:** the Engineering Lead key owns the lane, so only card authors, assignees and that key
   can move columns. Should BotFather own it (re-create from Richard's client) or be added to the lane channel?
6. **More QA bots:** one `qa-bot` key today; each extra QA bot needs its own keygen + add-member.
7. **Owner attestation (NIP-OA)** for the three new identities, signed from Richard's Buzz client.
8. **Peer identities:** the 14 existing peers can be assignees but don't post to the board (peer runtime not wired; out of v0 scope).
9. **Import mapping:** sprint "Done" rows land in Done (not In Review); "Halted" lands in Backlog with label `halted`; the dropped row is Closed.
10. **Retiring the markdown tracker:** the file was not modified; Project Manager to mark it superseded.
11. **Autostart:** the board SPA was already under supervised autostart before this work; keep it?
