const test = require('node:test');
const assert = require('node:assert/strict');
const { profileLabel } = require('../src/profile');

test('uses a safe fallback when an imported profile has no display name', () => {
  assert.equal(profileLabel({ id: 'user_42', displayName: null }), 'Anonymous');
});

