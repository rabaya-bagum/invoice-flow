module.exports = {
  preset: 'jest-expo',
  // The first test in each file pays for compiling React Native on a cold CI runner (>5s).
  testTimeout: 30000,
  setupFiles: ['<rootDir>/jest.setup.js'],
  testPathIgnorePatterns: ['/node_modules/', '/.expo/'],
  // Metro resolves the shared package via its "react-native" field; mirror that here.
  moduleNameMapper: { '^@invoiceflow/shared$': '<rootDir>/../packages/shared/src' },
};
