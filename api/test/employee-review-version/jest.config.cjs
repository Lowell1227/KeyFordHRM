module.exports = {
  rootDir: '.',
  testRegex: '\\.integration\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: require('node:path').resolve(__dirname, '../../tsconfig.json') }] },
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/../../src/$1' },
  testEnvironment: 'node',
  maxWorkers: 1,
  testTimeout: 30000,
};
