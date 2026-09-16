/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  // Deliberately excludes *.integration.test.ts — those require a real
  // running Postgres (see docker-compose.yml) and are run separately via
  // `npm run test:integration`. Plain `npm test` must stay fast and not
  // depend on any external service, so contributors get a quick feedback
  // loop without needing Docker running.
  testMatch: ["**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "\\.integration\\.test\\.ts$"],
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.d.ts", "!src/index.ts"],
  // Matches tsconfig.json's CommonJS setup — no ESM configuration needed.
};
