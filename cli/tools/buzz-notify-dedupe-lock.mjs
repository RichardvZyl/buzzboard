// Exclusive lock for the notify dedupe store. No network.
// A dead holder's lock is older than 30 s. Two waiters can both observe that age.
// Rename the stale file to a unique name before deleting it: only the rename winner
// unlinks, so the other waiter cannot delete the lock the winner just created.
import {randomUUID} from 'node:crypto';
import {closeSync, openSync, renameSync, rmSync, statSync} from 'node:fs';

export const DEDUPE_LOCK_STALE_MS = 30000;
export const DEDUPE_LOCK_TIMEOUT_MS = 10000;

const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Rename a stale lock aside and delete that unique name. False if it is fresh, missing, or another waiter won the rename. */
export function reclaimStaleLock(lockPath, {staleMs = DEDUPE_LOCK_STALE_MS, now = Date.now, unique = () => `${process.pid}.${randomUUID()}`} = {}) {
  let mtimeMs;
  try { mtimeMs = statSync(lockPath).mtimeMs; } catch { return false; }
  if (now() - mtimeMs <= staleMs) return false;
  const doomed = `${lockPath}.${unique()}.stale`;
  try { renameSync(lockPath, doomed); } catch { return false; }
  try { rmSync(doomed, {force: true}); } catch { /* the unique name is not the live lock */ }
  return true;
}

export function withFileLock(lockPath, fn, {staleMs = DEDUPE_LOCK_STALE_MS, timeoutMs = DEDUPE_LOCK_TIMEOUT_MS, sleep = sleepMs} = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { closeSync(openSync(lockPath, 'wx')); break; } catch (e) {
      // EPERM: on Windows the previous holder's lock file is still being deleted.
      if (!['EEXIST', 'EPERM', 'EBUSY'].includes(e.code)) throw e;
      if (reclaimStaleLock(lockPath, {staleMs})) continue;
      if (Date.now() > deadline) throw new Error(`dedupe store lock busy (${lockPath})`);
      sleep(20);
    }
  }
  try { return fn(); } finally { rmSync(lockPath, {force: true}); }
}
