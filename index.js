'use strict';

const {setTimeout: sleep} = require('node:timers/promises');

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
  // The database property exists on Reference, but not Query. Doing ref.ref ensures we are dealing
  // with a Reference instance.
  const accessTokenObj = await ref.ref.database.app.options.credential.getAccessToken();

  const url = new URL(ref.toString() + '.json');
  url.searchParams.set('shallow', 'true');
  url.searchParams.set('access_token', accessTokenObj.access_token);
  const abortController = new AbortController();
  let timeoutId;
  if (options.timeout !== undefined) {
    const timeoutError = new Error(
      `Timed out fetching children keys from Firebase REST API after ${options.timeout}ms.`
    );
    timeoutError.name = 'TimeoutError';
    if (options.timeout === 0) {
      abortController.abort(timeoutError);
    } else {
      timeoutId = setTimeout(() => abortController.abort(timeoutError), options.timeout);
    }
  }
  let tries = 0;

  async function sleepUntilRetry() {
    try {
      await sleep(options.retryInterval || 1000, undefined, {signal: abortController.signal});
    } catch (error) {
      if (abortController.signal.aborted) throw abortController.signal.reason;
      throw error;
    }
  }

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
    let match;
    match = data.match(/"error"\s*:\s*"([^"]*)"/);
    if (match) throw new Error(`Failed to fetch children keys from Firebase REST API: ${match[1]}`);
    const regex = /"(.*?)"/g;
    const keys = [];
    // eslint-disable-next-line no-cond-assign
    while (match = regex.exec(data)) keys.push(match[1]);  // don't unescape keys!
    return keys;
  }

  try {
    return await tryRequest();
  } finally {
    clearTimeout(timeoutId);
  }
};
