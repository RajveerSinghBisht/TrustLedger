/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.integration.test.ts"],
  // No coverage collection here — coverage is tracked via the fast unit
  // suite (jest.config.js), not this one.
};
