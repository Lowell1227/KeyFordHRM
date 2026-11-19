module.exports = {
  rootDir: '.',
  testRegex: '\\.integration\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/../../src/$1' },
  testEnvironment: 'node',
  testTimeout: 30000,
};
