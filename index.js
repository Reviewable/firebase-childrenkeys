'use strict';

const timers = require('safe-timers');

function parseChildrenKeys(data) {
  const whitespace = /[ \t\r\n]*/y;
  function skipWhitespace(position) {
    whitespace.lastIndex = position;
    whitespace.exec(data);
    return whitespace.lastIndex;
  }

  let position = skipWhitespace(0);
  function invalidResponse() {
    throw new SyntaxError(`Invalid shallow response at position ${position}`);
  }

  if (data[position] !== '{') {
    const value = JSON.parse(data);
    if (value !== null && typeof value === 'object') invalidResponse();
    return [];
  }
  position = skipWhitespace(position + 1);
  if (data[position] === '}') {
    position = skipWhitespace(position + 1);
    if (position !== data.length) invalidResponse();
    return [];
  }

  // Shallow children always have true values; the API error envelope has a string value.
  // eslint-disable-next-line no-control-regex
  const string = /"(?:[^"\\\x00-\x1f]|\\.)*"/.source;
  const space = whitespace.source;
  const entry = new RegExp(
    `(${string})${space}:${space}(true|${string})${space}([,}])`, 'y');
  const keys = [];
  for (;;) {
    entry.lastIndex = position;
    const match = entry.exec(data);
    if (!match) invalidResponse();
    // Keep ordinary keys cheap, and let JSON.parse decode only strings with JSON escapes.
    const key = match[1].includes('\\') ? JSON.parse(match[1]) : match[1].slice(1, -1);
    position = skipWhitespace(entry.lastIndex);
    if (match[2] !== 'true') {
      if (key !== 'error' || keys.length || match[3] !== '}' || position !== data.length) {
        invalidResponse();
      }
      throw new Error(
        `Failed to fetch children keys from Firebase REST API: ${JSON.parse(match[2])}`);
    }
    keys.push(key);
    if (match[3] === '}') {
      if (position !== data.length) invalidResponse();
      return keys;
    }
  }
}

/**
 * Fetches the keys of the current reference's children without also fetching all the contents,
 * using the Firebase REST API.
 *
 * @param {Reference} ref A Firebase database reference.
 * @param {object} options An options object with the following items, all optional:
 *   - maxTries: the maximum number of times to try to fetch the keys, in case of transient errors
 *               (defaults to 1)
 *   - retryInterval: the number of milliseconds to delay between retries (defaults to 1000)
 *   - timeout: the maximum number of milliseconds for all fetch attempts and retry delays
 * @return A promise that resolves to an array of key strings.
 */
module.exports = async (ref, options = {}) => {
  const refIsNonNullObject = typeof ref === 'object' && ref !== null;
  if (!refIsNonNullObject || typeof ref.ref !== 'object' ||
      typeof ref.ref.transaction !== 'function') {
    throw new Error(
      `Expected first argument passed to childrenKeys() to be a Firebase Database reference, but
      got "${ref}".`
    );
  } else if (typeof options !== 'object' || options === null) {
    throw new Error(
      `Expected second argument passed to childrenKeys() to be an options object, but got
      "${options}".`
    );
  } else if (options.timeout !== undefined &&
      (typeof options.timeout !== 'number' || !Number.isFinite(options.timeout) ||
       options.timeout < 0)) {
    throw new Error(
      `Expected timeout passed to childrenKeys() to be a non-negative finite number, but got
      "${options.timeout}".`
    );
  }
  const abortController = new AbortController();
  let timeoutTimer, timeoutPromise;
  if (options.timeout !== undefined) {
    const timeoutError = new DOMException(
      `Timed out fetching children keys after ${options.timeout}ms.`,
      'TimeoutError'
    );
    if (options.timeout === 0) {
      abortController.abort(timeoutError);
    } else {
      timeoutPromise = new Promise((resolve, reject) => {
        timeoutTimer = timers.setTimeout(() => {
          abortController.abort(timeoutError);
          reject(timeoutError);
        }, options.timeout);
      });
    }
  }

  function sleepUntilRetry() {
    if (abortController.signal.aborted) {
      return Promise.reject(abortController.signal.reason);
    }
    return new Promise((resolve, reject) => {
      const retry = {};
      const handleAbort = () => {
        timers.clearTimeout(retry.timer);
        reject(abortController.signal.reason);
      };
      retry.timer = timers.setTimeout(() => {
        abortController.signal.removeEventListener('abort', handleAbort);
        resolve();
      }, options.retryInterval || 1000);
      abortController.signal.addEventListener('abort', handleAbort, {once: true});
    });
  }

  async function run() {
    // The database property exists on Reference, but not Query. Doing ref.ref ensures we are
    // dealing with a Reference instance.
    const accessTokenObj = await ref.ref.database.app.options.credential.getAccessToken();
    if (abortController.signal.aborted) throw abortController.signal.reason;

    const url = new URL(ref.toString() + '.json');
    url.searchParams.set('shallow', 'true');
    url.searchParams.set('access_token', accessTokenObj.access_token);
    let tries = 0;

    async function tryRequest() {
      tries++;
      let data;
      try {
        const response = await fetch(url, {signal: abortController.signal});
        data = await response.text();
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${data}`);
      } catch (error) {
        if (abortController.signal.aborted) throw abortController.signal.reason;
        if (options.maxTries && tries < options.maxTries) {
          await sleepUntilRetry();
          return tryRequest();
        }
        throw error;
      }
      // Validate and extract keys without constructing a full intermediate object for large nodes.
      try {
        return parseChildrenKeys(data);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw new Error(
          `Failed to parse children keys response: ${error.message}`, {cause: error});
      }
    }

    return tryRequest();
  }

  try {
    if (abortController.signal.aborted) throw abortController.signal.reason;
    const requestPromise = run();
    return await (timeoutPromise ? Promise.race([timeoutPromise, requestPromise]) : requestPromise);
  } finally {
    timers.clearTimeout(timeoutTimer);
  }
};
