# Buzz Board CLI — canonical home

This `cli/` tree is the **canonical** home for the Buzz Board bot CLI, roster,
fixtures and proof artefacts.

| Piece | Where |
|---|---|
| This CLI | `cli/` in the `RichardvZyl/buzzboard` repository |
| Web SPA | `spa/` in this same repository (served on the board host `:8401`) |
| Live card/ticket events | Buzz relay (Nostr) + docker volume `buzz-server_pg` — **not** files in this folder |
| Host-local config | `%LOCALAPPDATA%\buzz-board\config.json` (outside any repo) |
| Secrets | Windows Credential Manager `A2A/BUZZ_<SLUG>_SECRET_KEY` only |

## Why it left Grok-Bot-Workspace

`E:\Grok-Bot-Workspace` is scratch and import/export only. The board serves every
A2A agent and peer, so its code belongs in this shared repository (engineering
standards **10** repository layout under `${repos_root}/{owner}/{name}/root`, and
**14** / skill convention for host-local config outside the tree).

## History

Imported 2026-11-05 from `grok-bot-workspace` path `a2a/buzz-board` (live
implementation taken from the `fully-merged` worktree). Source tip commits
included `8fc6318`, `742969c`, `6942d25`, `b1249e3` and the buzz-board v0 AC
series. A pre-move filesystem snapshot is at
`E:\Development\archives\buzz-board-pre-relocate-20261105` (name deliberately
avoids `scratch`/`temp`/`backup`/`bak` cleanup sweeps).

## Run

```powershell
cd <this-repo>\cli
node tools\buzz-board.mjs list --as <your-slug>
```

See `README.md` and `HOW-TO-ADD-AGENT.md` in this folder.
