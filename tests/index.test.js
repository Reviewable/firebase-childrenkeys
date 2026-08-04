'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const childrenKeys = require('../index.js');

function makeRef() {
  const ref = {
    database: {
      app: {
        options: {
          credential: {
            getAccessToken: async () => ({'access_token': 'token'}),
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
