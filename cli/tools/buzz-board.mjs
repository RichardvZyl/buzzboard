#!/usr/bin/env node
// Buzz Board v0 bot CLI: lets a bot read, post, claim and close tasks on the Buzz Board
// (buzzboard conventions: NIP-34 issues + status events on the Buzz relay), signing with
// that bot's OWN Nostr key. Keys live in Windows Credential Manager (generic credential
// A2A/BUZZ_<BOT>_SECRET_KEY, e.g. A2A/BUZZ_QA_BOT_SECRET_KEY) for the account the bots run as,
// read via the host's WinCred.ps1 helper; they are never printed, logged or put into the
// environment or command line of child processes.
//
// Local config (outside the repo) is a JSON file at $BUZZ_BOARD_CONFIG or
// <LOCALAPPDATA>/buzz-board/config.json:
//   { "relayUrlFile": "<file holding the relay wss:// URL>",
//     "nostrToolsFrom": "<a folder whose node_modules has nostr-tools>",
//     "winCredScript": "<path to the host's WinCred.ps1 (Get-/Set-WinCredSecret)>",
//     "lane": { "owner": "<lane owner hex pubkey>", "d": "<lane slug>" } }
//
// Commands (all output is JSON on stdout; public keys only):
//   keygen <bot>                    create credential A2A/BUZZ_<BOT>_SECRET_KEY (refuses to overwrite)
//   whoami --as <bot>               pubkey + npub
//   profile --as <bot> --name <n> [--about <t>]   publish kind-0 profile
//   lane-create --as <bot> --name <n> --slug <d> [--about <t>] [--members <hex,hex>]
//   lane   --as <bot>                 latest lane event (kind 30617), raw + maintainers
//   lane-maintainers --as <bot> [--add <hex,hex>] [--remove <hex,hex>] [--dry-run]
//                                   republish the lane (kind 30617) keeping every tag, editing only
//                                   ["maintainers", hex, ...]; lane author only; --dry-run prints it unsigned
//   post   --as <bot> --title <t> [--body <b>] [--label <l>]...
//   (every --issue <id> below also takes the id as the first positional argument, and a unique hex
//    prefix of at least 8 chars, e.g. the 12-char short ids used in notes, is resolved to the full id)
//   claim  --as <bot> --issue <id>          assign to self + In Progress (kind 1630)
//   resolve --as <bot> --issue <id> [--note <t>]   kind 1631 (assignee: In Review; author/owner: Done)
//   close  --as <bot> --issue <id> [--note <t>]    kind 1632 (Closed)
//   list   --as <bot> [--raw]                 cards with derived column/assignee
//   get    --as <bot> --issue <id>            raw issue + status events
//   assigned --as <bot>                       open cards (not done/closed) assigned to this bot's pubkey
//   channel-read --as <bot> --channel <uuid> [--since <ISO|unix>] [--limit N] [--kinds 9|all|k,k] [--mine]
//                                   NIP-42-authenticated WebSocket read of a Buzz channel (tag h=<uuid>,
//                                   default kind 9 chat); flags messages signed by Richard (BotFather); exits on EOSE
//   import --as <bot> --fixture <file.json>   idempotent import (tag ["fixture", id, row])
import {createRequire} from 'node:module';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const die = (msg, code = 1) => { process.stderr.write(`buzz-board: ${msg}\n`); process.exit(code); };
const cfgPath = process.env.BUZZ_BOARD_CONFIG || join(process.env.LOCALAPPDATA || join(process.env.HOME || '.', '.local', 'share'), 'buzz-board', 'config.json');
if (!existsSync(cfgPath)) die(`config not found (${cfgPath ? 'set BUZZ_BOARD_CONFIG' : ''})`);
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));
const req = createRequire(join(cfg.nostrToolsFrom, 'package.json'));
const load = async (spec) => { const m = await import(pathToFileURL(req.resolve(spec)).href); return {...(m.default || {}), ...m}; };
const pure = await load('nostr-tools/pure');
const nip19 = await load('nostr-tools/nip19');
const {finalizeEvent, getPublicKey} = pure;

const K = {PROFILE: 0, ISSUE: 1621, OPEN: 1630, RESOLVED: 1631, CLOSED: 1632, DRAFT: 1633, CREATE_CHANNEL: 9007, ADD_MEMBER: 9000, REPO: 30617};
const STATUS = [K.OPEN, K.RESOLVED, K.CLOSED, K.DRAFT];

// ---- args ----
const [cmd, ...rest] = process.argv.slice(2);
const args = {_: []};
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a.startsWith('--')) { const k = a.slice(2); const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true; if (k in args) args[k] = [].concat(args[k], v); else args[k] = v; }
  else args._.push(a);
}
const list = (v) => (v === undefined ? [] : [].concat(v));
const out = (o) => process.stdout.write(JSON.stringify(o, null, 2) + '\n');
const BOT_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;

// ---- keys (never printed) ----
// Credential Manager access goes through a PowerShell child that dot-sources WinCred.ps1. The target
// name is passed in the environment; the secret only travels over the child's stdout/stdin pipe.
function credTarget(bot) { if (!BOT_RE.test(bot || '')) die('bad bot name'); return `A2A/BUZZ_${bot.toUpperCase().replace(/-/g, '_')}_SECRET_KEY`; }
function winCred(script, target, input, user = '') {
  if (!cfg.winCredScript || !existsSync(cfg.winCredScript)) die('config.winCredScript not set or missing');
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `. $env:BB_WINCRED; ${script}`],
      {env: {...process.env, BB_WINCRED: cfg.winCredScript, BB_TARGET: target, BB_USER: user}, input: input ?? '', stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true}).toString('utf8');
  } catch (e) { return e.status === 3 ? null : die(`credential access failed for ${target} (exit ${e.status})`); }
}
const credRead = (t) => winCred('$s = [WinCredNative]::Read($env:BB_TARGET); if ($null -eq $s) { exit 3 }; [Console]::Out.Write($s)', t);
const credCreate = (t, user, hex) => winCred('if ($null -ne [WinCredNative]::Read($env:BB_TARGET)) { exit 4 }; Set-WinCredSecret $env:BB_TARGET $env:BB_USER ([Console]::In.ReadToEnd().Trim())', t, hex, user);
function loadSigner(bot) {
  const t = credTarget(bot);
  const got = credRead(t);
  if (got === null) die(`no key for ${bot} (credential ${t} not found)`);
  const hex = got.trim();
  if (!/^[0-9a-f]{64}$/.test(hex)) die(`credential ${t} is malformed`);
  const sk = Uint8Array.from(Buffer.from(hex, 'hex'));
  const pubkey = getPublicKey(sk);
  return {bot, pubkey, sign: (kind, tags, content = '') => finalizeEvent({kind, tags, content, created_at: Math.floor(Date.now() / 1000)}, sk)};
}

// ---- relay HTTP bridge with NIP-98 (same as buzzboard / buzz-cli) ----
function relayBase() {
  let u = readFileSync(cfg.relayUrlFile, 'utf8').trim().replace(/\/+$/, '');
  if (u.startsWith('wss://')) u = 'https://' + u.slice(6); else if (u.startsWith('ws://')) u = 'http://' + u.slice(5);
  return u;
}
async function post(signer, path, payload) {
  const url = relayBase() + path;
  const body = JSON.stringify(payload);
  const auth = signer.sign(27235, [['u', url], ['method', 'POST'], ['nonce', randomUUID()], ['payload', createHash('sha256').update(body).digest('hex')]]);
  const r = await fetch(url, {method: 'POST', headers: {Authorization: 'Nostr ' + Buffer.from(JSON.stringify(auth)).toString('base64'), 'Content-Type': 'application/json'}, body});
  const text = await r.text();
  if (!r.ok) die(`${path} failed (${r.status}): ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}
const query = (s, filters) => post(s, '/query', filters);
const submit = async (s, ev) => { await post(s, '/events', ev); return ev; };

function laneAddress() {
  if (!cfg.lane?.owner || !cfg.lane?.d) die('config.lane.owner / config.lane.d not set (run lane-create first)');
  return `${K.REPO}:${cfg.lane.owner}:${cfg.lane.d}`;
}
const tag = (ev, k) => ev.tags.find((t) => t[0] === k)?.[1];
const tagsOf = (ev, k) => ev.tags.filter((t) => t[0] === k).map((t) => t[1]);
const HEX_RE = /^[0-9a-f]{64}$/;
const hexList = (v) => list(v).flatMap((x) => String(x).split(',')).map((x) => x.trim().toLowerCase()).filter(Boolean);
// NIP-34 maintainers: ["maintainers", <hex>, <hex>, ...]; values from every such tag count.
const maintainersOf = (ev) => (ev ? ev.tags.filter((t) => t[0] === 'maintainers').flatMap((t) => t.slice(1)).map((x) => String(x).toLowerCase()).filter((x) => HEX_RE.test(x)) : []);
async function fetchLane(s) {
  laneAddress();
  const evs = await query(s, [{kinds: [K.REPO], authors: [cfg.lane.owner], '#d': [cfg.lane.d], limit: 10}]);
  return evs.sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1))[0] || null;
}
const brief = (ev) => ({id: ev.id, kind: ev.kind, pubkey: ev.pubkey, npub: nip19.npubEncode(ev.pubkey), created_at: ev.created_at, tags: ev.tags, content: ev.content, sig: ev.sig});

// Column derivation: a simplified port of buzzboard's deriveCard (strict actors only), plus lane
// maintainers from the lane event. NOTE: the buzzboard SPA's deriveCard does not read maintainers.
function derive(issue, statuses, maintainers = []) {
  const refs = statuses.filter((e) => e.tags.some((t) => t[0] === 'e' && t[1] === issue.id))
    .sort((a, b) => b.created_at - a.created_at || Number(a.kind === K.OPEN) - Number(b.kind === K.OPEN) || (a.id < b.id ? -1 : 1));
  const assignee = refs.map((e) => tag(e, 'assignee')).find((v) => v !== undefined) || null;
  const actors = new Set([issue.pubkey, cfg.lane.owner, assignee, ...maintainers].filter(Boolean));
  const st = refs.find((e) => actors.has(e.pubkey)) || null;
  let column = 'backlog';
  if (st) {
    const by = assignee && st.pubkey === assignee; const labels = tagsOf(st, 't');
    if (by && st.kind === K.OPEN && !labels.length) column = 'in_progress';
    else if (st.kind === K.OPEN && labels.includes('in-progress')) column = 'in_progress';
    else if (st.kind === K.OPEN && labels.includes('in-review')) column = 'in_review';
    else if (by && st.kind === K.RESOLVED) column = 'in_review';
    else if (by && st.kind === K.DRAFT) column = 'in_review (blocked)';
    else if (st.kind === K.RESOLVED) column = 'done';
    else if (st.kind === K.CLOSED) column = 'closed';
    else if (st.kind === K.DRAFT) column = 'triage';
  } else if (tagsOf(issue, 't').includes('triage')) column = 'triage';
  return {id: issue.id, subject: tag(issue, 'subject'), author: issue.pubkey, assignee, column, labels: tagsOf(issue, 't'), fixture: issue.tags.find((t) => t[0] === 'fixture') || null, statusEvents: refs.length};
}
async function fetchCards(s) {
  const a = laneAddress();
  const issues = await query(s, [{kinds: [K.ISSUE], '#a': [a], limit: 500}]);
  const ids = issues.map((i) => i.id);
  const statuses = ids.length ? await query(s, [{kinds: STATUS, '#e': ids, limit: 2000}, {kinds: STATUS, '#a': [a], limit: 2000}]) : [];
  const uniq = [...new Map(statuses.map((e) => [e.id, e])).values()];
  const maintainers = maintainersOf(await fetchLane(s));
  return {issues, statuses: uniq, maintainers};
}
const statusTags = (issueId, extra = []) => [['e', issueId, '', 'root'], ['a', laneAddress()], ['p', cfg.lane.owner], ...extra];
// Card id from --issue or the first positional argument. Full 64-char hex ids pass through; a shorter hex
// prefix (min 8 chars, e.g. the 12-char ids in notes) is resolved against this lane's cards and must match
// exactly one. Without this, a missing id reached the relay as null (400 'invalid type: null') and a short id
// as an invalid event id (400 'Invalid event ID'); claim/resolve/close would have signed an event with no target.
const ID_PREFIX_MIN = 8;
async function resolveIssueId(s) {
  const raw = args.issue !== undefined && args.issue !== true ? args.issue : args._[0];
  if (raw === undefined || raw === true || Array.isArray(raw)) die(`--issue <id> required (one card id: 64-char hex or a unique prefix of at least ${ID_PREFIX_MIN})`);
  const id = String(raw).trim().toLowerCase();
  if (HEX_RE.test(id)) return id;
  if (!/^[0-9a-f]+$/.test(id) || id.length < ID_PREFIX_MIN) die(`bad card id ${JSON.stringify(String(raw))}: need 64-char hex or a hex prefix of at least ${ID_PREFIX_MIN}`);
  const {issues} = await fetchCards(s);
  const hits = issues.filter((i) => i.id.startsWith(id));
  if (!hits.length) die(`no card in ${laneAddress()} starts with ${id}`);
  if (hits.length > 1) die(`card id prefix ${id} is ambiguous: ${hits.map((i) => i.id).join(', ')}`);
  return hits[0].id;
}

// ---- relay WebSocket with NIP-42 AUTH (read-only subscriptions) ----
// The relay answers REQs with CLOSED "auth-required" until the client answers its AUTH challenge
// with a kind-22242 event signed by the bot's own key (same signer as everything else here).
const RICHARD_PUBKEY = '0e517135c3076e4c171ade45b6366a7536d4b6e2d8eb13eb27d2337eb01e187d';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isoUtc = (t) => new Date(t * 1000).toISOString();
const isoSast = (t) => new Date((t + 7200) * 1000).toISOString().replace('Z', '+02:00');
function parseSince(v) {
  if (v === undefined || v === true) return undefined;
  const s = String(v); if (/^\d+$/.test(s)) return Number(s);
  const ms = Date.parse(s); if (Number.isNaN(ms)) die(`bad --since ${s} (ISO date or unix seconds)`);
  return Math.floor(ms / 1000);
}
function wsSubscribe(signer, filters, {timeoutMs = 20000} = {}) {
  const url = readFileSync(cfg.relayUrlFile, 'utf8').trim().replace(/\/+$/, '');
  if (typeof WebSocket !== 'function') die('this Node has no global WebSocket (need Node 22+)');
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const events = new Map(); const notices = [];
    let authed = false; let authId = null; let subId = null; let waitingForAuth = false; let reqs = 0; let done = false;
    const finish = (err, extra = {}) => {
      if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch {}
      err ? reject(err) : resolve({events: [...events.values()], authed, notices, ...extra});
    };
    const timer = setTimeout(() => finish(new Error(`timeout after ${timeoutMs} ms (authed=${authed}; notices=${JSON.stringify(notices).slice(0, 300)})`)), timeoutMs);
    const sendReq = () => { if (reqs >= 3) return finish(new Error('relay kept refusing the subscription')); reqs++; subId = 'cr-' + randomUUID().slice(0, 8); ws.send(JSON.stringify(['REQ', subId, ...filters])); };
    // give the relay a moment to send its AUTH challenge first; if it doesn't, just subscribe
    ws.onopen = () => setTimeout(() => { if (!subId && !authId) sendReq(); }, 1500);
    ws.onerror = (e) => finish(new Error('websocket error: ' + (e?.message || e?.error?.message || 'unknown')));
    ws.onclose = () => finish(new Error(`relay closed the connection before EOSE (authed=${authed})`));
    ws.onmessage = (m) => {
      let msg; try { msg = JSON.parse(typeof m.data === 'string' ? m.data : Buffer.from(m.data).toString('utf8')); } catch { return; }
      const type = msg[0];
      if (type === 'AUTH') {
        const ev = signer.sign(22242, [['relay', url], ['challenge', String(msg[1])]]);
        authId = ev.id; ws.send(JSON.stringify(['AUTH', ev]));
      } else if (type === 'OK' && msg[1] === authId) {
        authed = msg[2] === true;
        if (!authed) return finish(new Error('NIP-42 AUTH rejected: ' + String(msg[3] || '').slice(0, 200)));
        if (!subId || waitingForAuth) { waitingForAuth = false; sendReq(); }
      } else if (type === 'EVENT' && msg[1] === subId && msg[2]?.id) {
        events.set(msg[2].id, msg[2]);
      } else if (type === 'EOSE' && msg[1] === subId) {
        finish(null);
      } else if (type === 'CLOSED' && msg[1] === subId) {
        const reason = String(msg[2] || '');
        if (/^auth-required/.test(reason)) { if (authed) sendReq(); else waitingForAuth = true; return; }
        finish(new Error('subscription closed by relay: ' + reason.slice(0, 200)));
      } else if (type === 'NOTICE') notices.push(String(msg[1]).slice(0, 200));
    };
  });
}
async function readChannel(s, channel, {since, limit, kinds}) {
  const f = {'#h': [channel], limit};
  if (kinds) f.kinds = kinds;
  if (since !== undefined) f.since = since;
  const {events, authed, notices} = await wsSubscribe(s, [f]);
  const msgs = events.sort((a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : 1)).map((e) => ({
    id: e.id, kind: e.kind, created_at: e.created_at, created_at_utc: isoUtc(e.created_at), created_at_sast: isoSast(e.created_at),
    pubkey: e.pubkey, signer_is_richard: e.pubkey === RICHARD_PUBKEY, sig_valid: pure.verifyEvent({...e}),
    mentions: tagsOf(e, 'p'), content: e.content,
  }));
  return {authed, notices, msgs};
}

// ---- commands ----
switch (cmd) {
  case 'keygen': {
    const bot = args._[0]; const t = credTarget(bot);
    if (credRead(t) !== null) die(`key for ${bot} already exists (${t}); refusing to overwrite`);
    const sk = Uint8Array.from(randomBytes(32));
    credCreate(t, `buzz-board-${bot}`, Buffer.from(sk).toString('hex'));
    if ((credRead(t) || '').trim() !== Buffer.from(sk).toString('hex')) die(`credential ${t} did not read back`);
    const pk = getPublicKey(sk);
    out({bot, pubkey: pk, npub: nip19.npubEncode(pk)});
    break;
  }
  case 'whoami': { const s = loadSigner(args.as); out({bot: s.bot, pubkey: s.pubkey, npub: nip19.npubEncode(s.pubkey)}); break; }
  case 'profile': {
    const s = loadSigner(args.as);
    const ev = await submit(s, s.sign(K.PROFILE, [], JSON.stringify({name: args.name, display_name: args.name, about: args.about || 'Grok Bot agent on the A2A Buzz Board', bot: true})));
    out(brief(ev)); break;
  }
  case 'lane-create': {
    const s = loadSigner(args.as);
    const channelId = randomUUID(); const events = [];
    events.push(await submit(s, s.sign(K.CREATE_CHANNEL, [['h', channelId], ['name', args.name], ['about', `buzzboard lane: ${args.name}`]])));
    for (const pk of String(args.members || '').split(',').filter(Boolean)) events.push(await submit(s, s.sign(K.ADD_MEMBER, [['h', channelId], ['p', pk], ['role', 'bot']])));
    const tags = [['d', args.slug], ['name', args.name], ['buzz-channel', channelId]];
    if (args.about) tags.push(['description', args.about]);
    events.push(await submit(s, s.sign(K.REPO, tags)));
    out({lane: `${K.REPO}:${s.pubkey}:${args.slug}`, channelId, events: events.map(brief)}); break;
  }
  case 'lane': {
    const s = loadSigner(args.as); const lane = await fetchLane(s);
    if (!lane) die(`lane ${laneAddress()} not found on the relay`);
    out({lane: laneAddress(), maintainers: maintainersOf(lane), event: brief(lane)}); break;
  }
  case 'lane-maintainers': {
    const s = loadSigner(args.as);
    const add = hexList(args.add); const remove = hexList(args.remove);
    if (!add.length && !remove.length) die('--add and/or --remove required (comma-separated hex pubkeys)');
    const bad = [...add, ...remove].filter((x) => !HEX_RE.test(x));
    if (bad.length) die(`not 64-char hex pubkeys: ${bad.join(', ')}`);
    const lane = await fetchLane(s);
    if (!lane) die(`lane ${laneAddress()} not found on the relay`);
    if (s.pubkey !== lane.pubkey || s.pubkey !== cfg.lane.owner) die(`${s.bot} is not the lane author; only ${lane.pubkey} can republish ${laneAddress()}`);
    const before = maintainersOf(lane);
    const after = [...new Set([...before, ...add])].filter((x) => !remove.includes(x));
    // keep every tag in place; the first maintainers tag becomes the merged one, later ones are dropped
    const tags = []; let placed = false;
    for (const t of lane.tags) {
      if (t[0] !== 'maintainers') { tags.push(t); continue; }
      if (!placed && after.length) tags.push(['maintainers', ...after]);
      placed = true;
    }
    if (!placed && after.length) tags.push(['maintainers', ...after]);
    const created_at = Math.max(Math.floor(Date.now() / 1000), lane.created_at + 1);
    const summary = {lane: laneAddress(), previousEvent: lane.id, maintainersBefore: before, maintainersAfter: after};
    if (args['dry-run']) { out({...summary, dryRun: true, event: {kind: K.REPO, pubkey: s.pubkey, created_at, tags, content: lane.content}}); break; }
    const ev = s.sign(K.REPO, tags, lane.content);
    if (ev.created_at <= lane.created_at) die('clock is behind the current lane event; refusing to publish an older replacement');
    out({...summary, event: brief(await submit(s, ev))}); break;
  }
  case 'post': {
    const s = loadSigner(args.as);
    if (!args.title) die('--title required');
    const tags = [['a', laneAddress()], ['p', cfg.lane.owner], ['subject', String(args.title)], ...list(args.label).map((l) => ['t', String(l)])];
    out(brief(await submit(s, s.sign(K.ISSUE, tags, String(args.body || ''))))); break;
  }
  case 'claim': {
    const s = loadSigner(args.as);
    const id = await resolveIssueId(s);
    out(brief(await submit(s, s.sign(K.OPEN, statusTags(id, [['t', 'in-progress'], ['assignee', s.pubkey]]), args.note || `claimed by ${s.bot}`)))); break;
  }
  case 'resolve': { const s = loadSigner(args.as); const id = await resolveIssueId(s); out(brief(await submit(s, s.sign(K.RESOLVED, statusTags(id), args.note || `resolved by ${s.bot}`)))); break; }
  case 'close': { const s = loadSigner(args.as); const id = await resolveIssueId(s); out(brief(await submit(s, s.sign(K.CLOSED, statusTags(id), args.note || `closed by ${s.bot}`)))); break; }
  case 'list': {
    const s = loadSigner(args.as); const {issues, statuses, maintainers} = await fetchCards(s);
    out(args.raw ? {issues: issues.map(brief), statuses: statuses.map(brief), maintainers} : {lane: laneAddress(), maintainers, cards: issues.map((i) => derive(i, statuses, maintainers))}); break;
  }
  case 'get': {
    const s = loadSigner(args.as);
    const id = await resolveIssueId(s);
    const [issue] = await query(s, [{ids: [id]}]);
    if (!issue) die(`issue ${id} not found`);
    const st = await query(s, [{kinds: STATUS, '#e': [id], limit: 500}]);
    out({card: derive(issue, st, maintainersOf(await fetchLane(s))), issue: brief(issue), statuses: st.sort((a, b) => a.created_at - b.created_at).map(brief)}); break;
  }
  case 'import': {
    const s = loadSigner(args.as);
    const fx = JSON.parse(readFileSync(args.fixture, 'utf8').replace(/^\uFEFF/, ''));
    const {issues} = await fetchCards(s);
    const have = new Set(issues.map((i) => i.tags.find((t) => t[0] === 'fixture')).filter(Boolean).map((t) => `${t[1]}#${t[2]}`));
    const results = [];
    for (const row of fx.tasks) {
      const key = `${fx.fixtureId}#${row.row}`;
      if (have.has(key)) { results.push({row: row.row, skipped: 'already imported'}); continue; }
      const tags = [['a', laneAddress()], ['p', cfg.lane.owner], ['subject', row.title], ['fixture', fx.fixtureId, String(row.row)], ['t', 'sprint-2026-10-22'], ...(row.labels || []).map((l) => ['t', l])];
      const body = `Imported from fixture ${fx.fixtureId} (row ${row.row}).\nOwner: ${row.owner}\nStatus at import: ${row.status}\n\n${row.note}`;
      const issue = await submit(s, s.sign(K.ISSUE, tags, body));
      const map = {Done: K.RESOLVED, Dropped: K.CLOSED};
      if (map[row.status]) await submit(s, s.sign(map[row.status], statusTags(issue.id), `status at import: ${row.status}`));
      results.push({row: row.row, issue: issue.id, status: row.status});
    }
    out({fixtureId: fx.fixtureId, results}); break;
  }
  case 'channel-read': {
    const s = loadSigner(args.as);
    const channel = String(args.channel || '').toLowerCase();
    if (!UUID_RE.test(channel)) die('--channel <uuid> required');
    const limit = args.limit === undefined ? 50 : Number(args.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) die('--limit must be 1..1000');
    const kinds = args.kinds === undefined ? [9] : String(args.kinds) === 'all' ? null : String(args.kinds).split(',').map(Number);
    if (kinds && !kinds.every((k) => Number.isInteger(k) && k >= 0)) die('--kinds must be comma-separated integers or "all"');
    const since = parseSince(args.since);
    const {authed, notices, msgs: all} = await readChannel(s, channel, {since, limit, kinds});
    // --mine: only messages that p-tag this bot (BuzzBoard assignment pings and @mentions)
    const msgs = args.mine ? all.filter((m) => m.mentions.includes(s.pubkey)) : all;
    const richard = msgs.filter((m) => m.signer_is_richard && m.sig_valid);
    out({reader: s.bot, reader_pubkey: s.pubkey, channel, kinds: kinds || 'all', since: since ?? null, limit, mine: !!args.mine, nip42_authed: authed,
      count: msgs.length, richard_signed: richard.length, notices, messages: msgs});
    break;
  }
  case 'assigned': {
    const s = loadSigner(args.as); const {issues, statuses, maintainers} = await fetchCards(s);
    const mine = issues.map((i) => derive(i, statuses, maintainers)).filter((c) => c.assignee === s.pubkey);
    const open = mine.filter((c) => c.column !== 'closed' && c.column !== 'done');
    out({bot: s.bot, pubkey: s.pubkey, lane: laneAddress(), open: open.length, doneOrClosed: mine.length - open.length, cards: open});
    break;
  }
  default: die('usage: buzz-board.mjs <keygen|whoami|profile|lane-create|lane|lane-maintainers|post|claim|resolve|close|list|assigned|get|channel-read|import> ...');
}
