const test = require('node:test');
const assert = require('node:assert/strict');
const { SearchSession } = require('../src/search-session');

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

test('keeps the latest search result when an older request finishes last', async () => {
  const pending = new Map();
  const fetchResults = (query) => {
    const request = deferred();
    pending.set(query, request);
    return request.promise;
  };

  const session = new SearchSession();
  const oldRequest = session.search('legacy query', fetchResults);
  const latestRequest = session.search('fresh query', fetchResults);

  pending.get('fresh query').resolve({ query: 'fresh query', ids: ['new'] });
  await latestRequest;

  pending.get('legacy query').resolve({ query: 'legacy query', ids: ['old'] });
  await oldRequest;

  assert.deepEqual(session.latestResult, { query: 'fresh query', ids: ['new'] });
});

