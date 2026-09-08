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

async function fetchKeysFor(actualKeys) {
  const body = JSON.stringify(Object.fromEntries(actualKeys.map(key => [key, true])));
  const originalFetch = global.fetch;
  global.fetch = async () => ({ok: true, status: 200, text: async () => body});
  try {
    return await childrenKeys(makeRef());
  } finally {
    global.fetch = originalFetch;
  }
}

async function fetchKeysForBody(body) {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ok: true, status: 200, text: async () => body});
  try {
    return await childrenKeys(makeRef());
  } finally {
    global.fetch = originalFetch;
  }
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

test('returns keys containing double quotes', async () => {
  assert.deepEqual(await fetchKeysFor(['foo', 'a"b']), ['foo', 'a"b']);
});

test('returns keys containing backslashes', async () => {
  assert.deepEqual(await fetchKeysFor(['foo', 'a\\b']), ['foo', 'a\\b']);
});

test('keeps scanning after escaped quotes and trailing backslashes', async () => {
  const keys = ['a"b', 'a\\', 'a\\"b', 'a\\\\', 'a,:{}b', 'last'];
  assert.deepEqual(await fetchKeysFor(keys), keys);
});

test('handles the \\u0022 escape form for double quotes', async () => {
  assert.deepEqual(await fetchKeysForBody('{"a\\u0022b":true}'), ['a"b']);
});

test('handles the \\u005C escape form for backslashes', async () => {
  assert.deepEqual(await fetchKeysForBody('{"a\\u005Cb":true}'), ['a\\b']);
});

test('treats an `error` child key as a regular key', async () => {
  assert.deepEqual(await fetchKeysFor(['error', 'foo']), ['error', 'foo']);
  assert.deepEqual(await fetchKeysFor(['error']), ['error']);
});

test('throws on the Firebase API error envelope', async () => {
  await assert.rejects(
    fetchKeysForBody('{"error":"Permission denied"}'),
    /Failed to fetch children keys from Firebase REST API: Permission denied/
  );
});

test('decodes JSON escapes in Firebase API errors', async () => {
  const message = 'Cannot read "a\\b"';
  await assert.rejects(fetchKeysForBody(JSON.stringify({error: message})), error => {
    assert.equal(error.message, `Failed to fetch children keys from Firebase REST API: ${message}`);
    return true;
  });
});

test('accepts JSON whitespace around entries and an empty object', async () => {
  assert.deepEqual(await fetchKeysForBody(' \t{\r\n "a" : true , "b" : true \n}\t'), ['a', 'b']);
  assert.deepEqual(await fetchKeysForBody(' \t{ \r\n } '), []);
});

test('returns an empty array for an empty (null) location', async () => {
  assert.deepEqual(await fetchKeysForBody('null'), []);
});

test('returns an empty array for a leaf string location', async () => {
  assert.deepEqual(await fetchKeysForBody('"hello"'), []);
});

test('throws on a non-JSON response and preserves the underlying cause', async () => {
  await assert.rejects(
    fetchKeysForBody('not valid json'),
    error => {
      assert.match(error.message, /Failed to parse children keys response/);
      assert.equal(error.cause instanceof Error, true);
      return true;
    }
  );
});

test('rejects incomplete entries, skipped input, and trailing data', async () => {
  const bodies = [
    ['{', 1, 'expected a complete quoted child key'],
    ['{"a"', 4, 'expected ":" after the child key'],
    ['{"a":', 5, 'expected true for a child value or a quoted API error message'],
    ['{"a":true', 9, 'expected "," or "}" after the child value'],
    ['{"a":true,"b":', 14, 'expected true for a child value or a quoted API error message'],
    ['{"a":true,bad,"b":true}', 10, 'expected a complete quoted child key'],
    ['{,"a":true}', 1, 'expected a complete quoted child key'],
    ['{"a":true,}', 10, 'expected a complete quoted child key'],
    ['{"a":true "b":true}', 10, 'expected "," or "}" after the child value'],
    ['{"a":true} trailing', 11, 'unexpected data after the closing brace'],
    ['{} trailing', 3, 'unexpected data after the closing brace'],
  ];
  for (const [body, position, reason] of bodies) {
    await assert.rejects(fetchKeysForBody(body), error => {
      assert.equal(error.message,
        `Failed to parse children keys response: Invalid shallow response at position ` +
        `${position}: ${reason}`);
      assert.equal(error.cause instanceof SyntaxError, true);
      return true;
    }, body);
  }
});

test('explains invalid shallow response shapes', async () => {
  const bodies = [
    ['[true]', 'expected a shallow object or primitive, not an array'],
    ['{"a":"value"}', 'string values require a single-field "error" envelope'],
    ['{"error":"message","a":true}', 'string values require a single-field "error" envelope'],
  ];
  for (const [body, reason] of bodies) {
    await assert.rejects(fetchKeysForBody(body), error => {
      assert.ok(error.message.endsWith(reason), error.message);
      assert.equal(error.cause instanceof SyntaxError, true);
      return true;
    }, body);
  }
});

test('rejects invalid JSON strings in keys', async () => {
  for (const body of ['{"a\\q":true}', '{"a\\u002X":true}', '{"a\nb":true}']) {
    await assert.rejects(fetchKeysForBody(body), error => {
      assert.match(error.message, /Failed to parse children keys response/);
      assert.equal(error.cause instanceof SyntaxError, true);
      return true;
    }, body);
  }
});
