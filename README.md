# firebase-childrenkeys

Exports a method which fetches the children keys of a Firebase Admin Database Reference via the
[REST API](https://firebase.google.com/docs/reference/rest/database/#section-param-shallow).

## API Reference

The default export is a method with the following signature:

`(ref[, options]) => string[]`

### Arguments

`ref` is a [Firebase Admin Database Reference](https://firebase.google.com/docs/reference/admin/node/admin.database.Reference).

`options` is an optional object containing the following configuration options:

- `maxRetries` - The maximum number of times to try to fetch the keys, in case of transient errors
  (defaults to `1`).
- `retryInterval` - The number of milliseconds to delay between retries (defaults to `1000`).

### Return Value

An array of strings representing the children keys of the provided Firebase Admin Database
Reference. If the provided reference has no children, the return value will be an empty array.

### Example Usage

```js
const admin = require('firebase-admin');
const firebaseChildrenKeys = require('firebase-childrenkeys');

admin.initializeApp(
  // ...
);

const db = admin.database();
const fooRef = db.ref('foo');

// Fetch all children keys of fooRef.
firebaseChildrenKeys(fooRef)
  .then((keys) => {
    if (keys.length === 0) {
      console.log('No children keys found.');
    }

    keys.forEach((key) => {
      console.log('Found child key:', key);
    });
  })
  .catch((error) => {
    console.log('Failed to fetch children keys:', error);
  });

// Fetch all children keys of fooRef, with an optional configuration.
firebaseChildrenKeys(fooRef, {
  maxRetries: 5,
  retryInterval: 500,
})
  .then((keys) => {
    if (keys.length === 0) {
      console.log('No children keys found.');
    }

    keys.forEach((key) => {
      console.log('Found child key:', key);
    });
  })
  .catch((error) => {
    console.log('Failed to fetch children keys:', error);
  });
```
