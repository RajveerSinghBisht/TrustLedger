require("@nomicfoundation/hardhat-toolbox");

// Per CONTRACTS_SPEC.md: local Hardhat network only for this phase.
// Do not add testnet networks/deployment config yet — that's a later
// phase once core logic is tested and working.

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
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
