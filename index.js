'use strict';

const axios = require('axios').default;
const sleep = require('sleep-promise');

/**
 * Fetches the keys of the current reference's children without also fetching all the contents,
 * using the Firebase REST API.
 *
 * @param {Reference} ref A Firebase database reference.
 * @param {object} options An options object with the following items, all optional:
 *   - maxTries: the maximum number of times to try to fetch the keys, in case of transient errors
 *               (defaults to 1)
 *   - retryInterval: the number of milliseconds to delay between retries (defaults to 1000)
 *   - agent: the HTTP(S) agent to use when requesting data.
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
  }

  // The database property exists on admin.database.Reference, but not admin.database.Query. Doing
  // ref.ref ensures we are dealing with an admin.database.Reference instance.
  const accessTokenObj = await ref.ref.database.app.options.credential.getAccessToken();

  const uri = ref.toString() + '.json';
  const qs = {
    shallow: true,
    access_token: accessTokenObj.access_token,  // eslint-disable-line camelcase
  };
  const agent = options.agent;
  let tries = 0;

  async function tryRequest() {
    tries++;
    let data;
    try {
      const response = await axios.get(uri, {
        params: qs, agent, responseType: 'text', transformResponse: [x => x]
      });
      data = response.data;
    } catch (error) {
      if (options.maxTries && tries < options.maxTries) {
        await sleep(options.retryInterval || 1000);
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

  return tryRequest();
};
