'use strict';

const Firebase = require('firebase');
const request = require('request');

/**
 * Tries to fetch they keys of all the children of this node, without also fetching all the
 * contents, using the Firebase REST API.
 * @param options An options object with the following items, all optional:
 *   - auth: an auth token to pass to the REST API
 *   - maxTries: the maximum number of times to try to fetch the keys, in case of transient errors
 *               (defaults to 1)
 *   - retryInterval: the number of milliseconds to delay between retries (defaults to 1000)
 * @return A promise that resolves to an array of key strings.
 */
Firebase.prototype.childrenKeys = function(options) {
  const uri = this.toString() + '.json';
  const qs = {shallow: true};
  if (options.auth) qs.auth = options.auth;
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
          const object = JSON.parse(data);
          resolve(object ? Object.keys(object) : []);
        }
      });
    }
    tryRequest();
  });
};
