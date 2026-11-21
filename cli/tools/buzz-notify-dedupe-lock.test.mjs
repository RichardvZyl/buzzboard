import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {reclaimStaleLock, withFileLock} from './buzz-notify-dedupe-lock.mjs';

function age(path, msAgo) {
  const t = new Date(Date.now() - msAgo);
  utimesSync(path, t, t);
}

test('a fresh lock is not reclaimed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buzz-lock-'));
  const lock = join(dir, 'notify-dedup.json.lock');
  try {
    writeFileSync(lock, 'fresh');
    assert.equal(reclaimStaleLock(lock), false);
    assert.equal(readFileSync(lock, 'utf8'), 'fresh');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('a stale lock is renamed aside before delete, and a replacement lock is left alone', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buzz-lock-'));
  const lock = join(dir, 'notify-dedup.json.lock');
  try {
    writeFileSync(lock, 'stale');
    age(lock, 31_000);
    assert.equal(reclaimStaleLock(lock), true);
    assert.equal(existsSync(lock), false);
    assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith('.stale')), []);

    writeFileSync(lock, 'fresh');
    age(lock, 0);
    assert.equal(reclaimStaleLock(lock), false);
    assert.equal(readFileSync(lock, 'utf8'), 'fresh');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('only one waiter wins the rename of a single stale lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buzz-lock-'));
  const lock = join(dir, 'notify-dedup.json.lock');
  try {
    writeFileSync(lock, 'stale');
    age(lock, 31_000);
    assert.equal(reclaimStaleLock(lock), true);
    assert.equal(reclaimStaleLock(lock), false);
    assert.equal(existsSync(lock), false);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('withFileLock takes over a stale lock and removes it when the holder finishes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buzz-lock-'));
  const lock = join(dir, 'notify-dedup.json.lock');
  try {
    writeFileSync(lock, 'stale');
    age(lock, 31_000);
    const result = withFileLock(lock, () => {
      assert.equal(existsSync(lock), true);
      assert.equal(readFileSync(lock, 'utf8'), '', 'the holder created a new lock, not the stale file');
      const heldAge = Date.now() - statSync(lock).mtimeMs;
      assert.ok(Math.abs(heldAge) < 5000, `fresh lock age ${heldAge}`);
      return 'held';
    });
    assert.equal(result, 'held');
    assert.equal(existsSync(lock), false);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
