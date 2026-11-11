#!/usr/bin/env node
// Host-side A2A (+ optional Buzz channel) delivery for per-card notify subscriptions.
// Secrets: front-door bearer from Credential Manager only; never printed.
// Dedupe store: %LOCALAPPDATA%\buzz-board\notify-dedup.json (outside repos / scratch sweeps).
//
// Usage:
//   node tools/buzz-notify-deliver.mjs --as <bot> --issue <id> --change <event> \
//        [--subject <t>] [--detail <d>] [--triggering-event <id>] [--dry-run]
import {createRequire} from 'node:module';
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {resolveTarget} from './cred-target.mjs';

const die = (msg, code = 1) => { process.stderr.write(`buzz-notify-deliver: ${msg}\n`); process.exit(code); };
const cfgPath = process.env.BUZZ_BOARD_CONFIG || join(process.env.LOCALAPPDATA || '', 'buzz-board', 'config.json');
if (!existsSync(cfgPath)) die(`config not found (${cfgPath})`);
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));
const req = createRequire(join(cfg.nostrToolsFrom, 'package.json'));
const load = async (spec) => { const m = await import(pathToFileURL(req.resolve(spec)).href); return {...(m.default || {}), ...m}; };
const pure = await load('nostr-tools/pure');
const {finalizeEvent, getPublicKey} = pure;

const NOTIFY_EVENTS = ['triage','backlog','in_progress','in_review','done','closed','assignee','comment'];
const A2A_DIRECT = { 'delegation-bot': 'http://127.0.0.1:8122/jsonrpc' };
const FRONT_DOOR = process.env.A2A_FRONT_DOOR || 'http://127.0.0.1:8095/jsonrpc';

const [,, ...rest] = process.argv;
const args = {};
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
    args[k] = v;
  }
}
const as = args.as;
const issue = args.issue;
const change = args.change;
if (!as || !issue || !change) die('usage: --as <bot> --issue <id> --change <event> [--subject ...] [--detail ...] [--triggering-event ...] [--dry-run]');
if (!NOTIFY_EVENTS.includes(change)) die(`bad --change (want one of ${NOTIFY_EVENTS.join(',')})`);
if (!/^[0-9a-f]{64}$/i.test(issue)) die('issue must be 64-hex');

function credTarget(bot) { try { return resolveTarget(bot); } catch (e) { die(e.message || 'bad bot name'); } }
function winCred(script, target) {
  if (!cfg.winCredScript || !existsSync(cfg.winCredScript)) die('config.winCredScript missing');
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `. $env:BB_WINCRED; ${script}`],
      {env: {...process.env, BB_WINCRED: cfg.winCredScript, BB_TARGET: target}, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true}).toString('utf8');
  } catch (e) { return e.status === 3 ? null : die(`credential access failed (exit ${e.status})`); }
}
const credRead = (t) => winCred('$s = [WinCredNative]::Read($env:BB_TARGET); if ($null -eq $s) { exit 3 }; [Console]::Out.Write($s)', t);

function loadSigner(bot) {
  const t = credTarget(bot);
  const got = credRead(t);
  if (got === null) die(`no key for ${bot}`);
  const hex = got.trim();
  if (!/^[0-9a-f]{64}$/.test(hex)) die(`credential ${t} malformed`);
  const sk = Uint8Array.from(Buffer.from(hex, 'hex'));
  return {bot, pubkey: getPublicKey(sk), sign: (kind, tags, content = '') => finalizeEvent({kind, tags, content, created_at: Math.floor(Date.now() / 1000)}, sk)};
}

function relayBase() {
  let u = readFileSync(cfg.relayUrlFile, 'utf8').trim().replace(/\/+$/, '');
  if (u.startsWith('wss://')) u = 'https://' + u.slice(6); else if (u.startsWith('ws://')) u = 'http://' + u.slice(5);
  return u;
}
async function post(signer, path, payload) {
  const url = relayBase() + path;
  const body = JSON.stringify(payload);
  const auth = signer.sign(27235, [['u', url], ['method', 'POST'], ['payload', createHash('sha256').update(body).digest('hex')]]);
  const res = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json', authorization: `Nostr ${Buffer.from(JSON.stringify(auth)).toString('base64')}`}, body});
  const text = await res.text();
  if (!res.ok) die(`relay ${path} ${res.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return text; }
}

function parseSubs(statuses, issueId) {
  const referencing = (statuses || [])
    .filter((ev) => (ev.tags || []).some((t) => t[0] === 'e' && t[1] === issueId))
    .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1));
  const carrier = referencing.find((ev) => (ev.tags || []).some((t) => t[0] === 'notify'));
  if (!carrier) return [];
  const bySlug = new Map();
  for (const t of carrier.tags) {
    if (t[0] !== 'notify' || t.length < 3) continue;
    const slug = String(t[1] || '').toLowerCase();
    if (!BOT_RE.test(slug)) continue;
    if (!bySlug.has(slug)) bySlug.set(slug, new Set());
    for (const raw of t.slice(2)) if (NOTIFY_EVENTS.includes(raw)) bySlug.get(slug).add(raw);
  }
  return [...bySlug.entries()].map(([agentSlug, events]) => ({
    agentSlug,
    events: NOTIFY_EVENTS.filter((e) => events.has(e)),
  })).filter((s) => s.events.length);
}

const dedupePath = join(process.env.LOCALAPPDATA || '.', 'buzz-board', 'notify-dedup.json');
function loadDedupe() {
  if (!existsSync(dedupePath)) return new Set();
  try {
    const j = JSON.parse(readFileSync(dedupePath, 'utf8'));
    return new Set(Array.isArray(j.keys) ? j.keys : []);
  } catch { return new Set(); }
}
function saveDedupe(set) {
  mkdirSync(dirname(dedupePath), {recursive: true});
  const keys = [...set].slice(-5000);
  writeFileSync(dedupePath, JSON.stringify({keys, updatedAt: new Date().toISOString()}, null, 2));
}

function frontDoorBearer() {
  const t = 'A2A/FRONTDOOR_BEARER_TOKEN';
  const got = winCred('$s = [WinCredNative]::Read($env:BB_TARGET); if ($null -eq $s) { exit 3 }; [Console]::Out.Write($s)', t);
  if (got === null) die('front-door bearer missing (A2A/FRONTDOOR_BEARER_TOKEN)');
  return got.trim();
}

async function a2aSend(slug, text) {
  const url = A2A_DIRECT[slug] || FRONT_DOOR;
  const headers = {'content-type': 'application/json'};
  if (!A2A_DIRECT[slug]) headers.authorization = `Bearer ${frontDoorBearer()}`;
  const body = {
    jsonrpc: '2.0',
    id: randomUUID(),
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        parts: [{type: 'text', text: A2A_DIRECT[slug] ? text : `[notify for ${slug}]\n${text}`}],
        messageId: randomUUID(),
        metadata: {caller: 'buzz-notify', notifyAgent: slug},
      },
    },
  };
  const res = await fetch(url, {method: 'POST', headers, body: JSON.stringify(body)});
  const raw = await res.text();
  if (!res.ok) die(`a2a ${slug} HTTP ${res.status}: ${raw.slice(0, 240)}`);
  return {url, status: res.status, body: raw.slice(0, 400)};
}

const signer = loadSigner(as);
const got = await post(signer, '/api/nip34/issues/' + issue, {});
// bridge shapes vary — accept {issue, statuses} or nested
const issueEv = got.issue || got.event || got;
const statuses = got.statuses || got.status_events || [];
const subject = args.subject || (issueEv.tags || []).find((t) => t[0] === 'subject')?.[1] || '(untitled)';
const subs = parseSubs(statuses, issue);
const recipients = subs.filter((s) => s.events.includes(change)).map((s) => s.agentSlug).sort();
const triggering = args['triggering-event'] || createHash('sha256').update(`${issue}:${change}:${args.detail || ''}:${Date.now()}`).digest('hex');
const already = loadDedupe();
const planned = [];
for (const slug of recipients) {
  const key = `${issue}:${slug}:${change}:${triggering}`;
  if (already.has(key)) continue;
  planned.push({slug, key});
}

const results = [];
for (const p of planned) {
  const text =
    `@${p.slug} Buzz card notification: **${subject}**\n` +
    `- change: \`${change}\`\n` +
    `- issue: \`${issue}\`` +
    (args.detail ? `\n${args.detail}` : '');
  if (args['dry-run']) {
    results.push({agent: p.slug, dryRun: true, dedupeKey: p.key});
    continue;
  }
  const a2a = await a2aSend(p.slug, text);
  already.add(p.key);
  results.push({agent: p.slug, a2a: {url: a2a.url, status: a2a.status}, dedupeKey: p.key});
}
if (!args['dry-run'] && results.length) saveDedupe(already);

process.stdout.write(JSON.stringify({
  issue,
  change,
  subscriptions: subs,
  delivered: results,
  skippedDeduped: recipients.length - planned.length,
}, null, 2) + '\n');
