'use strict';

const request = require('request');

/**
 * Fetches the keys of the current reference's children without also fetching all the contents,
 * using the Firebase REST API.
 * 
 * @param {Reference} ref A Firebase database reference.
 * @param {object} options An options object with the following items, all optional:
 *   - accessToken: a Google OAuth2 access token to pass to the REST API.
 *   - maxTries: the maximum number of times to try to fetch the keys, in case of transient errors
 *               (defaults to 1)
 *   - retryInterval: the number of milliseconds to delay between retries (defaults to 1000)
 * @return A promise that resolves to an array of key strings.
 */
module.exports = (ref, options = {}) => {
  const uri = ref.toString() + '.json';
  const qs = {shallow: true};
  if (options.accessToken) qs.access_token = options.accessToken;
  return new Promise((resolve, reject) => {
    let tries = 0;
    function tryRequest() {
      tries++;
      request({uri, qs}, function(error, response, data) {
        if (error && options.maxTries && tries < options.maxTries) {
          setTimeout(tryRequest, options.retryInterval || 1000);
        } else if (error) {
          reject(error);
        } else {
          try {
            const object = JSON.parse(data);
            if (object.error === 'Permission denied') {
              reject(
                new Error('Failed to fetch children keys from Firebase REST API: Permission denied')
              );
            } else {
              resolve(object ? Object.keys(object) : []);
            }
          } catch (error) {
            reject(error);
          }
        }
      });
    }
    tryRequest();
  });
};
