'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const childrenKeys = require('../index.js');

function makeRef(getAccessToken = async () => ({'access_token': 'token'})) {
  const ref = {
    database: {
      app: {
        options: {
          credential: {
            getAccessToken,
          },
        },
      },
    },
    toString: () => 'https://example.firebaseio.com/children',
    transaction: () => undefined,
  };
  ref.ref = ref;
  return ref;
}

function isTimeoutError(error, timeout) {
  assert.equal(error instanceof DOMException, true);
  assert.equal(error.name, 'TimeoutError');
  assert.match(error.message, new RegExp(`after ${timeout}ms`));
  return true;
}

test('timeout covers retry delays', async () => {
  const originalFetch = global.fetch;
  let attempts = 0;
  global.fetch = async () => {
    attempts++;
    return {
      ok: false,
      status: 503,
      text: async () => 'Unavailable',
    };
  };

  try {
    const startedAt = Date.now();
    await assert.rejects(
      childrenKeys(makeRef(), {maxTries: 100, retryInterval: 1000, timeout: 25}),
      error => isTimeoutError(error, 25)
    );
    assert.equal(attempts, 1);
    assert.ok(Date.now() - startedAt < 500, 'timeout should interrupt the retry delay');
  } finally {
    global.fetch = originalFetch;
  }
});

test('timeout includes credential acquisition', async () => {
  const originalFetch = global.fetch;
  let fetchCalled = false;
  global.fetch = async () => {
    fetchCalled = true;
  };

  try {
    const credentialNeverResolves = () => new Promise(() => undefined);
    await assert.rejects(
      childrenKeys(makeRef(credentialNeverResolves), {timeout: 25}),
      error => isTimeoutError(error, 25)
    );
    assert.equal(fetchCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('zero timeout expires before credential acquisition', async () => {
  let credentialCalled = false;
  const getAccessToken = async () => {
    credentialCalled = true;
    return {'access_token': 'token'};
  };

  await assert.rejects(
    childrenKeys(makeRef(getAccessToken), {timeout: 0}),
    error => isTimeoutError(error, 0)
  );
  assert.equal(credentialCalled, false);
});

test('timeout supports delays beyond the native timer limit', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => {
    await new Promise(resolve => setTimeout(resolve, 10));
    return {
      ok: true,
      status: 200,
      text: async () => '{"key":true}',
    };
  };

  try {
    const keys = await childrenKeys(makeRef(), {timeout: 2 ** 31});
    assert.deepEqual(keys, ['key']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('timeout aborts a fetch in progress after earlier retries', async () => {
  const originalFetch = global.fetch;
  let attempts = 0;
  const signals = [];
  let inProgressSignal;
  global.fetch = async (url, {signal}) => {
    attempts++;
    signals.push(signal);
    if (attempts === 1) throw new Error('Transient failure');
    inProgressSignal = signal;
    return new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), {once: true});
    });
  };

  try {
    await assert.rejects(
      childrenKeys(makeRef(), {maxTries: 3, retryInterval: 1, timeout: 25}),
      error => isTimeoutError(error, 25)
    );
    assert.equal(attempts, 2);
    assert.equal(signals[0], signals[1]);
    assert.equal(inProgressSignal.aborted, true);
    assert.equal(inProgressSignal.reason.name, 'TimeoutError');
  } finally {
    global.fetch = originalFetch;
  }
});
