/** @type {import('jest').Config} */
module.exports = {
  rootDir: "../../",
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/prisma/goal-tracking-demo/**/*.spec.ts"],
};
