module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Mirrors tsconfig's `baseUrl: "./"`, so bare imports like `common/promise` (used throughout
  // src/frontend/stores, e.g. LocationStore.ts/FileStore.ts) resolve the same way under Jest as
  // they do under the webpack build.
  modulePaths: ['<rootDir>'],
  setupFiles: [
    // FIXME: I did not manage to get Dexie working in an actual Electron test environment. Testing in JavaScript is
    // cursed, so indexeddb is replaced by an in-memory implementation.
    'fake-indexeddb/auto',
    // Crypto module is not stable in the node version we use, nor can we use the browser.
    '<rootDir>/tests/setup/jest.crypto.js',
  ],
};
