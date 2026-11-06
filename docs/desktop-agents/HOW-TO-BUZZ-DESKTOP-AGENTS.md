# How Buzz Desktop “Agents” work (RICH-SERVER)

This is **not** the Buzz Board kanban CLI (`buzz-board.mjs`). The **Agents** page
Richard sees (Fizz / Honey / Pollen + Welcome Team) is Buzz **Desktop**’s managed-agent
store for the workspace relay.

## Model

| Piece | Where it lives |
|---|---|
| Agents page UI | Buzz Desktop (`buzz-desktop.exe`), not the relay admin web or buzzboard :8401 |
| Agent records | `%APPDATA%\xyz.block.buzz.app\agents\managed-agents.json` |
| Teams | `%APPDATA%\xyz.block.buzz.app\agents\teams.json` |
| Agent private keys | OS keyring service `buzz-desktop` (Windows Credential Manager target `secrets.buzz-desktop`), keyed as `agent:<pubkey>`; may briefly sit inline as `private_key_nsec` then migrate |
| Owner attestation | NIP-OA `auth` tag on the agent profile / events, signed by the Desktop owner (BotFather) at create time |
| Relay membership | Separate: `buzz-admin add-member` + channel roles. Board bots already have this |

### Create path (upstream)

1. Desktop `create_managed_agent` **always mints a new Nostr keypair** (`Keys::generate()`).
2. It computes a NIP-OA `auth` tag with the **logged-in owner** signing keys (fail-closed).
3. It persists the record and stores the nsec in the keyring.
4. Runtime is either `backend: local` (ACP: `buzz-acp` + `agent_command` / model / provider) or `backend: provider` (stdin/stdout `buzz-backend-*` deploy protocol). There is **no first-class A2A or Grok webhook backend**.

CLI `buzz agents draft-create` only opens a prefilled Desktop form for owner review. It does
**not** create the agent, and it cannot import an existing WinCred identity. Upstream issue
tracking a real managed-agent CLI: block/buzz#3115.

### Reusing A2A / board identities

Official create cannot reuse `A2A/BUZZ_<SLUG>_SECRET_KEY`. To keep the same pubkey that is
already a relay/channel member, the import provisioner in `scripts/desktop-agents/` must:

1. Quit Buzz Desktop (editing the store while it runs races its in-memory copy).
2. Resolve each slug’s pubkey via `buzz-board.mjs whoami` (or the roster JSON).
3. Read the hex secret from Credential Manager (never print it).
4. Write a managed-agent record with that pubkey and an inline `private_key_nsec` (Desktop
   migrates it into the keyring on next launch).
5. Optionally attach a NIP-OA `auth` tag — **only** if BotFather’s owner key is available to
   sign; otherwise leave `auth_tag` null and have Richard attest later from Desktop.
6. Point `agent_command` at `a2a-bridge-agent.mjs` (custom local harness) so chat wakes the
   peer over the A2A front door or a Grok webhook.

## Teams

Teams are JSON records in `teams.json` with `persona_ids` and/or agents that set `team_id`.
Built-in Welcome Team (`builtin-team:welcome`) cannot be deleted. This repo’s manifest adds:

- `team:a2a-peers`
- `team:grok-bots`
- `team:engineering`

## Scripts (this repo)

| Script | Role |
|---|---|
| `scripts/desktop-agents/desktop-agents-manifest.json` | Target agents, teams, wiring |
| `scripts/desktop-agents/provision-desktop-agents.mjs` | Import existing identities into Desktop store (Desktop must be closed) |
| `scripts/desktop-agents/verify-desktop-agents.mjs` | Assert managed-agents.json / teams.json contain the roster |
| `scripts/desktop-agents/a2a-bridge-agent.mjs` | Local `agent_command` that forwards turns to A2A `:8095` or a Grok webhook |

Run from a machine that has the WinCred keys and the Desktop app data. Never commit secrets,
relay hostnames beyond what’s already public in ops docs, or Credential Manager values.
