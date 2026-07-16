const test = require('node:test');
const assert = require('node:assert/strict');
const { statusLabel } = require('../src/status-label');

test('normalizes numeric statuses returned by a third-party provider', () => {
  assert.equal(statusLabel({ provider: 'legacy-monitor', status: 503 }), '503');
});

