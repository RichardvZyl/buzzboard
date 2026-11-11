import {existsSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const BOT_RE = /^[a-z0-9][a-z0-9-]{1,40}$/;
export const TARGET_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_./-]{3,120}$/;

export function derivedTarget(bot) {
  if (!BOT_RE.test(bot || '')) throw new Error('bad bot name');
  return 'A2A/BUZZ_' + bot.toUpperCase().replace(/-/g, '_') + '_SECRET_KEY';
}

export function defaultRosterDir() {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'roster');
}

function looksLikeSecret(value) {
  return /^(?:nsec1|[0-9a-f]{64})$/i.test(value);
}

export function loadOverrides(rosterDir) {
  const dir = rosterDir || defaultRosterDir();
  const path = join(dir, 'credentials.local.json');
  if (!existsSync(path)) return {};
  const data = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  const map = (data && typeof data === 'object' && data.overrides && typeof data.overrides === 'object')
    ? data.overrides
    : data;
  const out = {};
  for (const [slug, target] of Object.entries(map)) {
    if (slug.startsWith('_') || slug === 'comment') continue;
    if (!BOT_RE.test(slug)) throw new Error('bad override slug ' + slug);
    if (typeof target !== 'string' || !TARGET_NAME_RE.test(target) || looksLikeSecret(target)) {
      throw new Error('override for ' + slug + ' is not a credential target name');
    }
    out[slug] = target;
  }
  return out;
}

export function resolveTarget(bot, rosterDir) {
  const overrides = loadOverrides(rosterDir || defaultRosterDir());
  return overrides[bot] || derivedTarget(bot);
}