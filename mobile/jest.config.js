/* eslint-disable @typescript-eslint/no-require-imports */
const preset = require('jest-expo/jest-preset');

module.exports = {
  preset: 'jest-expo',
  // The first test in each file pays for compiling React Native on a cold CI runner (>5s).
  testTimeout: 30000,
  setupFiles: ['<rootDir>/jest.setup.js'],
  // @noble/ciphers ships ES modules only; let Babel transform it like the Expo packages.
  transformIgnorePatterns: preset.transformIgnorePatterns.map((p) =>
    p.replace('(?!(.pnpm|', '(?!(.pnpm|@noble|'),
  ),
  testPathIgnorePatterns: ['/node_modules/', '/.expo/'],
  // Metro resolves the shared package via its "react-native" field; mirror that here.
  moduleNameMapper: { '^@invoiceflow/shared$': '<rootDir>/../packages/shared/src' },
};
