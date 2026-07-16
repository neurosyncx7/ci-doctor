const test = require('node:test');
const assert = require('node:assert/strict');
const { pageCount } = require('../src/pagination');

test('includes the final partial page after an exact page boundary', () => {
  assert.equal(pageCount(21, 10), 3);
});

