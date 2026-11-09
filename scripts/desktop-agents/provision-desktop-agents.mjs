#!/usr/bin/env node
/**
 * Import existing A2A/BUZZ_* identities into Buzz Desktop's Agents page store.
 *
 * HARD REQUIREMENTS:
 * - Buzz Desktop must be quit (this script refuses if buzz-desktop is running).
 * - Never prints secret key material.
 * - Does not mint new Nostr keys when a Credential Manager secret already exists.
 * - Leaves auth_tag null unless --owner-nsec-cred is supplied (BotFather); otherwise
 *   Richard must attest later from Desktop.
 *
 * Usage:
 *   node provision-desktop-agents.mjs [--dry-run] [--owner-nsec-cred <CredName>]
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes("--dry-run");
const ownerCredIdx = process.argv.indexOf("--owner-nsec-cred");
const ownerCred =
  ownerCredIdx >= 0 ? process.argv[ownerCredIdx + 1] : null;

const manifest = JSON.parse(
  readFileSync(join(__dirname, "desktop-agents-manifest.json"), "utf8"),
);

function expand(p) {
  return p
    .replace(/%APPDATA%/gi, process.env.APPDATA || "")
    .replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA || "")
    .replace(/%USERPROFILE%/gi, process.env.USERPROFILE || homedir());
}

function desktopRunning() {
  const r = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "if (Get-Process buzz-desktop -ErrorAction SilentlyContinue) { 'yes' } else { 'no' }",
    ],
    { encoding: "utf8" },
  );
  return (r.stdout || "").trim() === "yes";
}

function loadWinCredPs1() {
  const configPath = join(
    process.env.LOCALAPPDATA || "",
    "buzz-board",
    "config.json",
  );
  if (existsSync(configPath)) {
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    if (cfg.winCredScript) return cfg.winCredScript;
  }
  return "E:\\Tools\\autostart\\WinCred.ps1";
}

function getSecret(credName) {
  const wincred = loadWinCredPs1();
  const ps = `
    . '${wincred.replace(/'/g, "''")}'
    $v = Get-WinCredSecret '${credName.replace(/'/g, "''")}'
    if (-not $v) { exit 2 }
    [Console]::Out.Write($v)
  `;
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", ps],
    { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
  );
  if (r.status !== 0) return null;
  return (r.stdout || "").trim() || null;
}

function whoami(slug) {
  const candidates = [
    resolve(
      __dirname,
      "..",
      "..",
      "..",
      "relocate-cli-20261105",
      "cli",
      "tools",
      "buzz-board.mjs",
    ),
    "E:\\Development\\repositories\\RichardvZyl\\buzzboard\\relocate-cli-20261105\\cli\\tools\\buzz-board.mjs",
  ];
  const tool = candidates.find((p) => existsSync(p));
  if (!tool) return null;
  const cwd = dirname(tool);
  const r = spawnSync("node", [tool, "whoami", "--as", slug], {
    cwd,
    encoding: "utf8",
  });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

async function loadNostrTools() {
  const configPath = join(
    process.env.LOCALAPPDATA || "",
    "buzz-board",
    "config.json",
  );
  let from = null;
  if (existsSync(configPath)) {
    const cfg = JSON.parse(readFileSync(configPath, "utf8"));
    from = cfg.nostrToolsFrom;
  }
  const tryPaths = [
    from,
    "E:\\Development\\repositories\\RichardvZyl\\buzzboard\\root\\spa",
    "E:\\Development\\repositories\\RichardvZyl\\buzzboard\\relocate-cli-20261105\\spa",
  ].filter(Boolean);
  const require = createRequire(import.meta.url);
  for (const base of tryPaths) {
    try {
      return require(join(base, "node_modules", "nostr-tools"));
    } catch {
      /* next */
    }
  }
  throw new Error("nostr-tools not found; set buzz-board config nostrToolsFrom");
}

function nowIso() {
  return new Date().toISOString();
}

function bridgePath() {
  return resolve(__dirname, "a2a-bridge-agent.mjs");
}

function buildRecord({ agent, pubkey, nsec, teamId, relayUrl }) {
  const modelDefault =
    (agent.modelOptions || []).find((m) => m.default)?.id ||
    (agent.modelOptions || [])[0]?.id ||
    "";
  const env = {
    A2A_BRIDGE_SLUG: agent.a2aSlug || "",
    A2A_BRIDGE_MODEL: modelDefault,
    A2A_FRONTDOOR_URL: "http://127.0.0.1:8095/jsonrpc",
    A2A_FRONTDOOR_TOKEN_CRED: "A2A/FRONTDOOR_BEARER_TOKEN",
    A2A_BRIDGE_WINCRED_PS1: loadWinCredPs1(),
  };
  const fatherOrPro = (agent.modelOptions || []).find((m) => m.webhookCredUrl);
  if (fatherOrPro) {
    env.A2A_BRIDGE_WEBHOOK_URL_CRED = fatherOrPro.webhookCredUrl;
    if (fatherOrPro.webhookCredAuth) {
      env.A2A_BRIDGE_WEBHOOK_AUTH_CRED = fatherOrPro.webhookCredAuth;
    }
  }
  return {
    pubkey,
    name: agent.displayName,
    persona_id: null,
    team_id: teamId || null,
    auth_tag: null,
    private_key_nsec: nsec,
    relay_url: relayUrl,
    avatar_url: null,
    acp_command: "buzz-acp",
    agent_command: "node",
    agent_command_override: true,
    agent_args: [bridgePath()],
    mcp_command: "",
    turn_timeout_seconds: 600,
    idle_timeout_seconds: null,
    max_turn_duration_seconds: null,
    parallelism: 1,
    system_prompt: agent.systemPrompt,
    model: modelDefault || null,
    provider: agent.kind === "a2a-peer" ? "a2a-bridge" : "grok-webhook",
    env_vars: env,
    persona_source_version: null,
    start_on_app_launch: false,
    auto_restart_on_config_change: false,
    runtime_pid: null,
    backend: { type: "local" },
    backend_agent_id: null,
    provider_policy_pending: false,
    provider_binary_path: null,
    created_at: nowIso(),
    updated_at: nowIso(),
    last_started_at: null,
    last_stopped_at: null,
    last_exit_code: null,
    last_error: null,
    last_error_code: null,
    respond_to: "owner-only",
    respond_to_allowlist: [],
    is_builtin: false,
    is_active: true,
  };
}

function primaryTeam(agent) {
  return (agent.teams && agent.teams[0]) || null;
}

async function maybeAuthTag(nsecTools, ownerNsec, agentPubkey) {
  if (!ownerNsec) return null;
  // Best-effort: if nostr-tools exposes nip26-like helpers we skip — NIP-OA is
  // Buzz-specific (nostr:agent-auth:). Without buzz-sdk we leave null.
  void nsecTools;
  void agentPubkey;
  return null;
}

async function main() {
  if (desktopRunning()) {
    console.error(
      JSON.stringify({
        ok: false,
        error:
          "buzz-desktop is running; quit Desktop before importing agents (store would race)",
      }),
    );
    process.exit(3);
  }

  const agentsPath = expand(manifest.managedAgentsPath);
  const teamsPath = expand(manifest.teamsPath);
  if (!existsSync(agentsPath) || !existsSync(teamsPath)) {
    console.error(
      JSON.stringify({
        ok: false,
        error: "Desktop agent store not found",
        agentsPath,
        teamsPath,
      }),
    );
    process.exit(2);
  }

  const nostr = await loadNostrTools();
  const { getPublicKey, nip19 } = nostr;
  const hexToBytes = (hex) =>
    Uint8Array.from(hex.match(/.{1,2}/g).map((b) => parseInt(b, 16)));

  let relayUrl = "wss://rich-server.tail19e097.ts.net:9300";
  const boardCfg = join(process.env.LOCALAPPDATA || "", "buzz-board", "config.json");
  if (existsSync(boardCfg)) {
    const cfg = JSON.parse(readFileSync(boardCfg, "utf8"));
    if (cfg.relayUrlFile && existsSync(cfg.relayUrlFile)) {
      relayUrl = readFileSync(cfg.relayUrlFile, "utf8").trim();
    }
  }

  const existing = JSON.parse(readFileSync(agentsPath, "utf8"));
  const teams = JSON.parse(readFileSync(teamsPath, "utf8"));
  const byPubkey = new Set(existing.filter((a) => a.pubkey).map((a) => a.pubkey));

  const ownerNsec = ownerCred ? getSecret(ownerCred) : null;
  const created = [];
  const skipped = [];
  const failed = [];

  for (const agent of manifest.agents) {
    if (agent.identityStatus === "no-buzz-identity-roster-disabled") {
      skipped.push({ slug: agent.slug, reason: agent.identityStatus });
      continue;
    }
    const secret = getSecret(agent.credential);
    if (!secret) {
      failed.push({
        slug: agent.slug,
        reason: `credential missing: ${agent.credential}`,
      });
      continue;
    }
    let skHex = secret;
    if (secret.startsWith("nsec")) {
      const decoded = nip19.decode(secret);
      skHex = Buffer.from(decoded.data).toString("hex");
    }
    skHex = skHex.replace(/^0x/, "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(skHex)) {
      failed.push({ slug: agent.slug, reason: "secret is not 64-hex or nsec" });
      continue;
    }
    const pubkey = getPublicKey(hexToBytes(skHex));
    const id = whoami(agent.slug);
    if (id?.pubkey && id.pubkey !== pubkey) {
      failed.push({
        slug: agent.slug,
        reason: "whoami pubkey mismatch vs credential-derived pubkey",
      });
      continue;
    }
    if (byPubkey.has(pubkey)) {
      skipped.push({ slug: agent.slug, reason: "pubkey already in managed-agents.json" });
      continue;
    }
    const nsec = nip19.nsecEncode(hexToBytes(skHex));
    const auth_tag = await maybeAuthTag(nostr, ownerNsec, pubkey);
    const record = buildRecord({
      agent,
      pubkey,
      nsec,
      teamId: primaryTeam(agent),
      relayUrl,
    });
    record.auth_tag = auth_tag;
    if (!dryRun) {
      existing.push(record);
      byPubkey.add(pubkey);
    }
    created.push({
      slug: agent.slug,
      name: agent.displayName,
      pubkeyPrefix: pubkey.slice(0, 12),
      team_id: record.team_id,
      a2aSlug: agent.a2aSlug,
      auth_tag: Boolean(auth_tag),
    });
  }

  const now = nowIso();
  for (const team of manifest.teams) {
    if (teams.some((t) => t.id === team.id)) continue;
    const persona_ids = [];
    teams.push({
      id: team.id,
      name: team.name,
      description: team.description,
      persona_ids,
      is_builtin: false,
      shared: false,
      is_symlink: false,
      created_at: now,
      updated_at: now,
    });
  }

  if (!dryRun) {
    const bakDir = join(dirname(agentsPath), "backups");
    mkdirSync(bakDir, { recursive: true });
    const stamp = now.replace(/[:.]/g, "-");
    copyFileSync(agentsPath, join(bakDir, `managed-agents.${stamp}.json`));
    copyFileSync(teamsPath, join(bakDir, `teams.${stamp}.json`));
    // Strip nothing — Desktop migrates inline nsec into keyring on load.
    writeFileSync(agentsPath, JSON.stringify(existing, null, 2));
    writeFileSync(teamsPath, JSON.stringify(teams, null, 2));
  }

  console.log(
    JSON.stringify(
      {
        ok: failed.length === 0,
        dryRun,
        created,
        skipped,
        failed,
        note:
          "auth_tag left null unless Buzz NIP-OA helper + owner cred supplied; Richard should open Agents page after relaunch to confirm and attest",
      },
      null,
      2,
    ),
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err.message || err) }));
  process.exit(1);
});
