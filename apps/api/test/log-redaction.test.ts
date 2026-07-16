import test from 'node:test';
import assert from 'node:assert/strict';
import { redactLogText } from '../src/security/log-redaction.js';

test('redacts common credential shapes before a CI log becomes an evidence artifact', () => {
  const log = [
    'authorization: ghp_abcdefghijklmnopqrstuvwxyz1234567890',
    'token=github_pat_ABCDEFGHIJKL_abcdefghijklmnopqrstuvwxyz1234567890',
    'AWS_ACCESS_KEY_ID=AKIAABCDEFGHIJKLMNOP',
    'ordinary compiler output remains visible'
  ].join('\n');

  const redacted = redactLogText(log);
  assert.doesNotMatch(redacted, /ghp_|github_pat_|AKIA/);
  assert.match(redacted, /ordinary compiler output remains visible/);
  assert.match(redacted, /\[REDACTED\]/);
});
