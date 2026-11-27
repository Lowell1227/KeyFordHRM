module.exports = {
  ...require('./jest.config.js'),
  // Runtime assertions are unchanged; run the TypeScript program check separately.
  transform: { '^.+\\.(t|j)s$': ['ts-jest', { isolatedModules: true }] },
  maxWorkers: 1,
  workerIdleMemoryLimit: '768MB',
};
