/**
 * Decide a ticket's disposition from verified GitHub facts.
 * An absent or inconclusive fact keeps the ticket pending verification.
 */
export function archiveDisposition({ column, merged, closed, commits, defaultBranchMembership }) {
  if (column === 'closed') return { action: 'audit-only' };
  if (merged === true) return { action: column === 'done' ? 'close' : 'wait' };
  if (closed !== true || merged !== false || !Array.isArray(commits) || !commits.length) {
    return { action: 'wait' };
  }

  const hashes = [...new Set(commits)];
  if (hashes.some((sha) => !/^[a-f0-9]{40}$/.test(sha))) return { action: 'wait' };
  const membership = hashes.map((sha) => defaultBranchMembership?.get(sha));
  if (membership.some((value) => value !== true && value !== false)) return { action: 'wait' };

  const missing = hashes.filter((_, index) => membership[index] === false);
  if (missing.length) return { action: 'triage', missing };
  return { action: column === 'done' ? 'close' : 'wait' };
}
