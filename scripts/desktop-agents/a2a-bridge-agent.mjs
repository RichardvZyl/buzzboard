#!/usr/bin/env node
/**
 * Local Buzz Desktop agent_command shim.
 * Forwards a single turn to the A2A front door (preferred) or a Grok webhook.
 *
 * Env (set by Desktop / provisioner; never log secret values):
 *   A2A_BRIDGE_SLUG          front-door peer slug
 *   A2A_BRIDGE_MODEL         optional model option (sonnet|opus|mimo|father|pro|...)
 *   A2A_FRONTDOOR_URL        default http://127.0.0.1:8095/jsonrpc
 *   A2A_FRONTDOOR_TOKEN_CRED Credential Manager name (default A2A/FRONTDOOR_BEARER_TOKEN)
 *   A2A_BRIDGE_WEBHOOK_URL_CRED / A2A_BRIDGE_WEBHOOK_AUTH_CRED  optional Grok webhook
 *   A2A_BRIDGE_WINCRED_PS1   path to WinCred.ps1
 *
 * Input: argv join or stdin text = user message.
 * Output: assistant text on stdout. Secrets never printed.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const FRONTDOOR =
  process.env.A2A_FRONTDOOR_URL || "http://127.0.0.1:8095/jsonrpc";
const TOKEN_CRED =
  process.env.A2A_FRONTDOOR_TOKEN_CRED || "A2A/FRONTDOOR_BEARER_TOKEN";
const WINCRED =
  process.env.A2A_BRIDGE_WINCRED_PS1 ||
  "E:\\Tools\\autostart\\WinCred.ps1";

function getSecret(credName) {
  if (!credName) return null;
  const ps = `
    . '${WINCRED.replace(/'/g, "''")}'
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

async function readMessage() {
  if (process.argv.length > 2) return process.argv.slice(2).join(" ");
  if (!input.isTTY) {
    return readFileSync(0, "utf8").trim();
  }
  const rl = createInterface({ input, output });
  const line = await rl.question("");
  rl.close();
  return line.trim();
}

function extractText(result) {
  if (!result) return "";
  if (typeof result === "string") return result;
  if (result.message?.parts) {
    return result.message.parts
      .map((p) => p.text || p.content || "")
      .filter(Boolean)
      .join("\n");
  }
  if (result.artifacts) {
    return JSON.stringify(result.artifacts);
  }
  return JSON.stringify(result);
}

async function sendA2A(slug, message, model) {
  const token = getSecret(TOKEN_CRED);
  if (!token) {
    throw new Error(`missing front-door token credential ${TOKEN_CRED}`);
  }
  const text =
    model && model !== "default"
      ? `[model:${model}]\n${message}`
      : message;
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "message/send",
    params: {
      message: {
        role: "user",
        parts: [{ type: "text", text }],
        metadata: {
          caller: "buzz-desktop-bridge",
          target: slug,
          model: model || undefined,
        },
      },
    },
  };
  const res = await fetch(FRONTDOOR, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`front door non-JSON HTTP ${res.status}`);
  }
  if (!res.ok || json.error) {
    throw new Error(
      `front door error HTTP ${res.status}: ${json.error?.message || res.statusText}`,
    );
  }
  return extractText(json.result);
}

async function sendWebhook(message) {
  const urlCred = process.env.A2A_BRIDGE_WEBHOOK_URL_CRED;
  const authCred = process.env.A2A_BRIDGE_WEBHOOK_AUTH_CRED;
  const url = getSecret(urlCred);
  if (!url) throw new Error(`missing webhook url credential ${urlCred}`);
  const auth = authCred ? getSecret(authCred) : null;
  const headers = { "Content-Type": "application/json" };
  if (auth) headers.Authorization = auth.startsWith("Bearer ")
    ? auth
    : `Bearer ${auth}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ text: message }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`webhook HTTP ${res.status}`);
  return text || "(webhook accepted)";
}

async function main() {
  const slug = process.env.A2A_BRIDGE_SLUG;
  const model = process.env.A2A_BRIDGE_MODEL || "";
  const message = await readMessage();
  if (!message) {
    console.error("a2a-bridge-agent: empty message");
    process.exit(1);
  }
  try {
    let out;
    if (slug) {
      out = await sendA2A(slug, message, model);
    } else if (process.env.A2A_BRIDGE_WEBHOOK_URL_CRED) {
      out = await sendWebhook(message);
    } else {
      throw new Error("set A2A_BRIDGE_SLUG or A2A_BRIDGE_WEBHOOK_URL_CRED");
    }
    process.stdout.write(out.endsWith("\n") ? out : out + "\n");
  } catch (err) {
    console.error(`a2a-bridge-agent: ${err.message || err}`);
    process.exit(2);
  }
}

main();
