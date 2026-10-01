module.exports = {
  preset: 'jest-expo',
  setupFiles: ['<rootDir>/jest.setup.js'],
  testPathIgnorePatterns: ['/node_modules/', '/.expo/'],
  // Metro resolves the shared package via its "react-native" field; mirror that here.
  moduleNameMapper: { '^@invoiceflow/shared$': '<rootDir>/../packages/shared/src' },
};
