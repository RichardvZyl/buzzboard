import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {
  DEFAULT_DIRECTORY,
  directoryPath,
  disabledRefuse,
  loadDirectoryAgents,
  routingStateOf,
} from './buzz-notify-routing.mjs';

test('directoryPath prefers A2A_DIRECTORY and otherwise uses the live default', () => {
  assert.equal(directoryPath({}), DEFAULT_DIRECTORY);
  assert.equal(directoryPath({A2A_DIRECTORY: '  D:\\tmp\\directory.json  '}), 'D:\\tmp\\directory.json');
});

test('routingStateOf treats the new field as authoritative and derives from compatible flags', () => {
  assert.equal(routingStateOf({id: 'alpha', listed: true, routable: true, allEligible: true}), 'normal');
  assert.equal(routingStateOf({id: 'gemini', routable: false, status: 'disabled'}), 'disabled');
  assert.equal(routingStateOf({id: 'sandbox', routable: true, allEligible: false}), 'explicit-only');
  assert.equal(routingStateOf({id: 'kimi-k3', routable: true, allEligible: true, routingState: 'disabled'}), 'disabled');
});

test('disabledRefuse blocks disabled peers, including an alias, and allows explicit-only named notify', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buzz-notify-routing-'));
  const file = join(dir, 'directory.json');
  writeFileSync(file, JSON.stringify({
    agents: [
      {id: 'delegation-bot', aliases: ['delegation'], routable: true, allEligible: true, routingState: 'normal'},
      {id: 'kimi-k3', aliases: ['kimi'], listed: true, routable: false, allEligible: false, routingState: 'disabled'},
      {id: 'beta', listed: true, routable: true, allEligible: false, routingState: 'explicit-only'},
    ],
  }), 'utf8');
  try {
    const agents = loadDirectoryAgents(file);
    assert.equal(disabledRefuse('delegation-bot', agents), null);
    assert.equal(disabledRefuse('beta', agents), null);
    assert.match(disabledRefuse('kimi-k3', agents), /kimi-k3 is disabled/);
    assert.match(disabledRefuse('kimi', agents), /kimi is disabled/);
    assert.equal(disabledRefuse('unknown-bot', agents), null);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('loadDirectoryAgents fails open on a missing or invalid file', () => {
  const lines = [];
  const orig = process.stderr.write;
  process.stderr.write = (chunk, encoding, cb) => {
    lines.push(String(chunk).replace(/\r?\n$/, ''));
    const done = typeof encoding === 'function' ? encoding : cb;
    if (typeof done === 'function') done();
    return true;
  };
  const dir = mkdtempSync(join(tmpdir(), 'buzz-notify-routing-bad-'));
  try {
    const missing = join(dir, 'missing.json');
    assert.deepEqual(loadDirectoryAgents(missing), []);
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{not json', 'utf8');
    assert.deepEqual(loadDirectoryAgents(bad), []);
    assert.equal(lines.length, 2);
    for (const line of lines) assert.match(line, /^buzz-notify-deliver: directory file could not be read \(/);
    assert.match(lines[0], /missing\.json/);
    assert.match(lines[1], /bad\.json/);
    const before = lines.length;
    const good = join(dir, 'good.json');
    writeFileSync(good, JSON.stringify({agents: [{id: 'alpha'}]}), 'utf8');
    assert.deepEqual(loadDirectoryAgents(good), [{id: 'alpha'}]);
    assert.equal(lines.length, before, 'a readable directory does not warn');
  } finally {
    process.stderr.write = orig;
    rmSync(dir, {recursive: true, force: true});
  }
});
