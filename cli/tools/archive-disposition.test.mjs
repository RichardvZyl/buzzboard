import assert from 'node:assert/strict';
import { test } from 'node:test';
import { archiveDisposition } from './archive-disposition.mjs';

const first = 'a'.repeat(40);
const second = 'b'.repeat(40);
const pr = { column: 'done', closed: true, merged: false, commits: [first, second] };

test('uses exact membership for all commits of a closed unmerged PR', () => {
  assert.deepEqual(archiveDisposition({ ...pr, defaultBranchMembership: new Map([[first, true]]) }), { action: 'wait' });
  assert.deepEqual(archiveDisposition({ ...pr, defaultBranchMembership: new Map([[first, true], [second, false]]) }), {
    action: 'triage', missing: [second],
  });
  assert.deepEqual(archiveDisposition({ ...pr, defaultBranchMembership: new Map([[first, true], [second, true]]) }), {
    action: 'close',
  });
});

test('requires authoritative merge or commit evidence and preserves already closed tickets', () => {
  assert.deepEqual(archiveDisposition({ column: 'done' }), { action: 'wait' });
  assert.deepEqual(archiveDisposition({ column: 'done', merged: true }), { action: 'close' });
  assert.deepEqual(archiveDisposition({ column: 'in_review', merged: true }), { action: 'wait' });
  assert.deepEqual(archiveDisposition({ ...pr, column: 'closed' }), { action: 'audit-only' });
});
