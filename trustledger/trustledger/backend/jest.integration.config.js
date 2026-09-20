/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.integration.test.ts"],
  // No coverage collection here — coverage is tracked via the fast unit
  // suite (jest.config.js), not this one.

  // These tests submit real transactions to a real (local Hardhat)
  // JSON-RPC node and await real confirmations via tx.wait(). ethers v6's
  // JsonRpcProvider defaults to a 4000ms POLLING interval for detecting
  // newly mined blocks when not using a WebSocket subscription — even
  // though Hardhat automines a transaction instantly, the provider
  // watching for that confirmation may not notice until its next poll
  // tick. A test that submits several transactions in sequence (e.g.
  // registerIdentity, then setPermission, then recordAccess, each
  // awaited before the next starts — required for correct nonce
  // handling against a local automining node; see the extended comment
  // on serializeRelayerCall in accessControlService.ts) can accumulate
  // several poll cycles' worth of wait time well past Jest's 5000ms
  // default test timeout, even though nothing is actually hung — it's
  // genuinely just this slow under polling-based confirmation. 30
  // seconds gives real multi-transaction integration tests comfortable
  // headroom without masking an actual hang (which would still fail,
  // just after 30s instead of 5s).
  testTimeout: 30000,
};
