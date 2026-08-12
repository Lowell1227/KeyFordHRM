/** @type {import('jest').Config} */
module.exports = {
  rootDir: "../../",
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/prisma/realistic-demo/**/*.spec.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
};
