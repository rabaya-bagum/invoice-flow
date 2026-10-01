/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  // Resolve the shared package from source so tests don't depend on a prior build.
  moduleNameMapper: { '^@invoiceflow/shared$': '<rootDir>/../packages/shared/src' },
};
