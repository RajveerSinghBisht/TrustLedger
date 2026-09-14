require("@nomicfoundation/hardhat-toolbox");

// Per CONTRACTS_SPEC.md: local Hardhat network only for this phase.
// Do not add testnet networks/deployment config yet — that's a later
// phase once core logic is tested and working.

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      // Explicit, not left to Hardhat's default. Hardhat defaults to
      // the "paris" EVM target for solc >= 0.8.20 specifically to avoid
      // opcode-support issues on chains that don't yet support newer
      // opcodes (see https://hardhat.org/hardhat-runner/docs/config).
      // OpenZeppelin 5.6.x's Bytes.sol uses the `mcopy` opcode
      // (EIP-5656, introduced in the Cancun hard fork) — compiling
      // against "paris" fails with "Function mcopy not found" because
      // that opcode doesn't exist at that target. Since this project
      // only deploys to a local Hardhat network in this phase (see
      // CONTRACTS_SPEC.md — no testnet yet), targeting "cancun" is
      // safe: there's no older, real-world chain in scope that would
      // reject this opcode.
      evmVersion: "cancun",
      optimizer: {
        // No gas optimization pass for this phase per CONTRACTS_SPEC.md
        // ("What NOT to build in this phase"). Left off, not tuned.
        enabled: false,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      // default in-process network, used by `hardhat test`
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      // matches HARDHAT_RPC_URL in backend/.env — see BACKEND_SPEC.md
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    timeout: 40000,
  },
};
