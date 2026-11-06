#!/usr/bin/env node
// Buzz Board v0, AC3: scan for the board bots' Nostr secret keys. Loads each key (bots listed in
// roster/board-bots.json) from Windows Credential Manager via the host's WinCred.ps1, derives the
// forms a leak could take (hex, upper-case hex, nsec bech32, base64),
// and searches the given targets for any of them, plus any nsec1... string at all. Prints only
// labels, counts and public-key prefixes; never a secret or a host path.
// Usage: node secret-scan.mjs <label>=<dir> ... [git:<label>=<repo>] ...
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync, readdirSync, statSync, existsSync} from 'node:fs';
import {join, extname, dirname} from 'node:path';
import {pathToFileURL, fileURLToPath} from 'node:url';
const cfgPath = process.env.BUZZ_BOARD_CONFIG || join(process.env.LOCALAPPDATA, 'buzz-board', 'config.json');
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));
const req = createRequire(join(cfg.nostrToolsFrom, 'package.json'));
const load = async (s) => { const m = await import(pathToFileURL(req.resolve(s)).href); return {...(m.default || {}), ...m}; };
const {getPublicKey} = await load('nostr-tools/pure');
const {nsecEncode} = await load('nostr-tools/nip19');
const needles = []; const keys = [];
const roster = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'roster', 'board-bots.json'), 'utf8').replace(/^\uFEFF/, ''));
const credRead = (target) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  '. $env:BB_WINCRED; $s = [WinCredNative]::Read($env:BB_TARGET); if ($null -eq $s) { exit 3 }; [Console]::Out.Write($s)'],
  {env: {...process.env, BB_WINCRED: cfg.winCredScript, BB_TARGET: target}, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true}).toString('utf8');
for (const {bot} of [...roster.boardBots].sort((a, b) => a.bot.localeCompare(b.bot))) {
  const hex = credRead(`A2A/BUZZ_${bot.toUpperCase().replace(/-/g, '_')}_SECRET_KEY`).trim();
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`credential for ${bot} is malformed`);
  const sk = Uint8Array.from(Buffer.from(hex, 'hex'));
  keys.push({bot, pubkeyPrefix: getPublicKey(sk).slice(0, 12)});
  for (const v of [hex, hex.toUpperCase(), nsecEncode(sk), Buffer.from(sk).toString('base64')]) needles.push(Buffer.from(v));
}
const NSEC_RE = /nsec1[02-9ac-hj-np-z]{58}/;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', '__pycache__']);
const BIN = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.zip', '.gz', '.tar', '.7z', '.exe', '.dll', '.pdf', '.mp4', '.woff', '.woff2', '.ttf']);
const MAX = 50 * 1024 * 1024;
function scanBuf(buf) {
  let hits = 0; for (const n of needles) if (buf.indexOf(n) !== -1) hits++;
  const generic = NSEC_RE.test(buf.toString('latin1')) ? 1 : 0;
  return {hits, generic};
}
const results = [];
for (const arg of process.argv.slice(2)) {
  const isGit = arg.startsWith('git:'); const [label, target] = (isGit ? arg.slice(4) : arg).split(/=(.*)/s);
  const r = {target: label, kind: isGit ? 'git history (all refs, all diffs)' : 'files', files: 0, bytes: 0, skipped: 0, secretMatches: 0, filesWithSecret: 0, otherNsecStrings: 0};
  if (!existsSync(target)) { r.error = 'missing'; results.push(r); continue; }
  if (isGit) {
    const buf = execFileSync('git', ['-C', target, '-c', 'safe.directory=*', 'log', '--all', '-p', '--no-color', '--binary'], {maxBuffer: 2 * 1024 * 1024 * 1024});
    r.bytes = buf.length; r.files = Number(execFileSync('git', ['-C', target, '-c', 'safe.directory=*', 'rev-list', '--all', '--count']).toString().trim()); r.unit = 'commits';
    const s = scanBuf(buf); r.secretMatches = s.hits; r.filesWithSecret = s.hits ? 1 : 0; r.otherNsecStrings = s.generic;
  } else {
    const walk = (d) => { let ents; try { ents = readdirSync(d, {withFileTypes: true}); } catch { r.skipped++; return; }
      for (const e of ents) { const p = join(d, e.name);
        if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); continue; }
        if (!e.isFile() || BIN.has(extname(e.name).toLowerCase())) continue;
        let st; try { st = statSync(p); } catch { r.skipped++; continue; }
        if (st.size > MAX) { r.skipped++; continue; }
        let buf; try { buf = readFileSync(p); } catch { r.skipped++; continue; }
        r.files++; r.bytes += buf.length; const s = scanBuf(buf);
        if (s.hits) { r.secretMatches += s.hits; r.filesWithSecret++; } r.otherNsecStrings += s.generic; } };
    walk(target);
  }
  results.push(r);
}
const total = results.reduce((a, r) => a + r.secretMatches, 0);
const other = results.reduce((a, r) => a + r.otherNsecStrings, 0);
process.stdout.write(JSON.stringify({scan: 'buzz-board-v0 AC3 secret scan', at: new Date().toISOString(), keysChecked: keys, formsPerKey: ['hex', 'HEX', 'nsec', 'base64'], targets: results, totalSecretMatches: total, totalOtherNsecStrings: other, result: total === 0 ? 'PASS: no board bot secret key found in any target' : 'FAIL'}, null, 2) + '\n');
