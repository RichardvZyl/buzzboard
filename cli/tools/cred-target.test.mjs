import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import {derivedTarget, loadOverrides, resolveTarget, defaultRosterDir} from './cred-target.mjs';

test('derivedTarget follows the slug convention', () => {
  assert.equal(derivedTarget('claude'), 'A2A/BUZZ_CLAUDE_SECRET_KEY');
  assert.equal(derivedTarget('cline-free'), 'A2A/BUZZ_CLINE_FREE_SECRET_KEY');
  assert.equal(derivedTarget('a2a-maintainer'), 'A2A/BUZZ_A2A_MAINTAINER_SECRET_KEY');
  assert.throws(() => derivedTarget('Bad_Slug'), /bad bot name/);
});

test('resolveTarget uses an override file when present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buzz-cred-'));
  try {
    writeFileSync(join(dir, 'credentials.local.json'), JSON.stringify({
      _comment: 'placeholders only',
      'example-bot': 'A2A/BUZZ_OTHER_BOT_SECRET_KEY',
    }));
    assert.equal(resolveTarget('example-bot', dir), 'A2A/BUZZ_OTHER_BOT_SECRET_KEY');
    assert.equal(resolveTarget('claude', dir), 'A2A/BUZZ_CLAUDE_SECRET_KEY');
    const overrides = loadOverrides(dir);
    assert.equal(overrides['example-bot'], 'A2A/BUZZ_OTHER_BOT_SECRET_KEY');
    assert.equal(overrides._comment, undefined);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('loadOverrides rejects secret-like values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'buzz-cred-'));
  try {
    writeFileSync(join(dir, 'credentials.local.json'), JSON.stringify({
      'example-bot': '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    }));
    assert.throws(() => loadOverrides(dir), /not a credential target name/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('defaultRosterDir points at cli/roster', () => {
  assert.match(defaultRosterDir().replace(/\\/g, '/'), /cli\/roster$/);
});