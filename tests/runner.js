'use strict';

const _ = require('lodash');
const assert = require('assert');

const admin = require('./loadFirebase');
const childrenKeys = require('../index.js');

const mockData = {
  one: 1,
  two: 'two',
  three: true,
  four: {
    five: 5,
    six: 6,
    seven: 7,
  },
};

console.log(`[INFO] Running tests...`);

const rootRef = admin.database().ref();
const testRef = rootRef.child('childrenKeys');

testRef.set(mockData)
  .then(() => childrenKeys(testRef))
  .then((keys) => {
    assert(
      _.isEqual(keys.sort(), Object.keys(mockData).sort()),
      'Children keys should return top-level keys'
    );

    console.log(`[INFO] All tests passed!`);
    process.exit(0);
  })
  .catch((error) => {
    console.log(`[ERROR] Tests failed:`, error);
    process.exit(1);
  });
