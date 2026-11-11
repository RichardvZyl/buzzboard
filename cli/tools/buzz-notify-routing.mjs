/** Directory-card routing gate for Buzz notify-deliver (card 79200ff4).
 * Named notify is an explicit call: explicit-only is allowed; disabled is a hard refuse,
 * including the delegation-bot :8122 bypass that otherwise skips the front door.
 * Hidden does not block named delivery (it is a listing/discovery flag).
 */
import {existsSync, readFileSync} from 'node:fs';

export const DEFAULT_DIRECTORY = 'C:\\Services\\a2a\\current\\directory.json';

export function directoryPath(env = process.env) {
  return (env.A2A_DIRECTORY ?? '').trim() || DEFAULT_DIRECTORY;
}

export function loadDirectoryAgents(dirPath, {readFileSync: read = readFileSync, existsSync: exists = existsSync} = {}) {
  try {
    if (!exists(dirPath)) return [];
    const d = JSON.parse(read(dirPath, 'utf8').replace(/^\uFEFF/, ''));
    return Array.isArray(d.agents) ? d.agents : [];
  } catch {
    return [];
  }
}

export function routingStateOf(a) {
  if (a?.routingState === 'normal' || a?.routingState === 'explicit-only' || a?.routingState === 'disabled') return a.routingState;
  if (String(a?.status || '').toLowerCase() === 'disabled' || a?.routable === false) return 'disabled';
  if (a?.allEligible === false) return 'explicit-only';
  return 'normal';
}

export function findDirectoryAgent(agents, slug) {
  const t = String(slug || '').toLowerCase();
  return agents.find((a) => a.id === t || (Array.isArray(a.aliases) && a.aliases.some((x) => String(x).toLowerCase() === t)));
}

/** Hard refuse for routingState=disabled on every notify path, including A2A_DIRECT. */
export function disabledRefuse(slug, agents) {
  const a = findDirectoryAgent(agents, slug);
  if (!a) return null;
  if (routingStateOf(a) === 'disabled') {
    return `${slug} is disabled (routingState=disabled); notify delivery refused (including direct peer ports)`;
  }
  return null;
}
