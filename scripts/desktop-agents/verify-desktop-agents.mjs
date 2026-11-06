#!/usr/bin/env node
/**
 * Verify Buzz Desktop Agents page store against desktop-agents-manifest.json.
 * Read-only. Never prints secrets.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(__dirname, "desktop-agents-manifest.json"), "utf8"),
);

function expand(p) {
  return p
    .replace(/%APPDATA%/gi, process.env.APPDATA || "")
    .replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA || "");
}

const agentsPath = expand(manifest.managedAgentsPath);
const teamsPath = expand(manifest.teamsPath);

if (!existsSync(agentsPath)) {
  console.error(JSON.stringify({ ok: false, error: "managed-agents.json missing", agentsPath }));
  process.exit(2);
}
if (!existsSync(teamsPath)) {
  console.error(JSON.stringify({ ok: false, error: "teams.json missing", teamsPath }));
  process.exit(2);
}

const agents = JSON.parse(readFileSync(agentsPath, "utf8"));
const teams = JSON.parse(readFileSync(teamsPath, "utf8"));

const byName = new Map(
  agents
    .filter((a) => a.pubkey)
    .map((a) => [String(a.name || a.display_name || "").toLowerCase(), a]),
);

const expected = manifest.agents.filter(
  (a) =>
    a.identityStatus !== "no-buzz-identity-roster-disabled" &&
    a.identityStatus !== "missing-credential-at-authoring",
);

const missing = [];
const present = [];
for (const a of expected) {
  const hit =
    byName.get(a.displayName.toLowerCase()) ||
    agents.find(
      (r) =>
        r.pubkey &&
        (String(r.name || "").toLowerCase() === a.slug.toLowerCase() ||
          String(r.name || "").toLowerCase() === a.displayName.toLowerCase()),
    );
  if (hit) present.push({ slug: a.slug, name: hit.name, pubkeyPrefix: hit.pubkey.slice(0, 12) });
  else missing.push({ slug: a.slug, displayName: a.displayName });
}

const teamIds = new Set(teams.map((t) => t.id));
const missingTeams = manifest.teams.filter((t) => !teamIds.has(t.id)).map((t) => t.id);

const report = {
  ok: missing.length === 0 && missingTeams.length === 0,
  agentsPresent: present.length,
  agentsExpectedProvisionable: expected.length,
  missingAgents: missing,
  missingTeams,
  teamsFound: teams.map((t) => ({ id: t.id, name: t.name })),
  builtins: agents
    .filter((a) => a.is_builtin || !a.pubkey)
    .map((a) => a.name || a.slug),
  deferred: manifest.agents
    .filter((a) => a.identityStatus)
    .map((a) => ({ slug: a.slug, identityStatus: a.identityStatus, wireStatus: a.wireStatus })),
  skipped: manifest.skipped,
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 1);
