import "dotenv/config";

/**
 * Central environment validation. Import this module FIRST, before
 * anything else that depends on process.env — it throws immediately and
 * explicitly if a required variable is missing or malformed, rather than
 * letting the server start and fail confusingly later (e.g. a mysterious
 * "Cannot read property of undefined" deep inside a contract call, or a
 * silently wrong RELAYER_PRIVATE_KEY producing a valid-looking but wrong
 * signer address).
 */

interface Config {
  hardhatRpcUrl: string;
  identityRegistryAddress: string;
  accessControlAddress: string;
  assetRegistryAddress: string;
  relayerPrivateKey: string;
  backendSigningPrivateKey: string;
  documentMasterKey: string;
  databaseUrl: string;
  port: number;
  authDomain: string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env and fill in a real value.`
    );
  }
  return value;
}

function requireEthAddress(name: string): string {
  const value = requireEnv(name);
  // Basic shape check: 0x + 40 hex chars. Does not verify checksum casing
  // — ethers.js will do that when the address is actually used.
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(
      `Environment variable ${name} does not look like a valid Ethereum ` +
        `address (expected 0x followed by 40 hex characters). Got: ${value}`
    );
  }
  return value;
}

function requireHexPrivateKey(name: string): string {
  const value = requireEnv(name);
  // 0x + 64 hex chars (32 bytes). Applies to RELAYER_PRIVATE_KEY, which
  // MUST be a real secp256k1 private key. BACKEND_SIGNING_PRIVATE_KEY is
  // intentionally NOT required to pass this same check — see the
  // .env.example note: it does not need to be a real Ethereum key, only
  // a sufficiently random value, so it is validated separately as a
  // plain non-empty string via requireEnv, not this stricter check.
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error(
      `Environment variable ${name} does not look like a valid private ` +
        `key (expected 0x followed by 64 hex characters).`
    );
  }
  return value;
}

let cachedConfig: Config | null = null;

/**
 * Returns the validated config, throwing on first access if anything
 * required is missing or malformed. Cached after first successful call
 * — validation runs once, not on every access.
 */
export function getConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  cachedConfig = {
    hardhatRpcUrl: requireEnv("HARDHAT_RPC_URL"),
    identityRegistryAddress: requireEthAddress("IDENTITY_REGISTRY_ADDRESS"),
    accessControlAddress: requireEthAddress("ACCESS_CONTROL_ADDRESS"),
    assetRegistryAddress: requireEthAddress("ASSET_REGISTRY_ADDRESS"),
    relayerPrivateKey: requireHexPrivateKey("RELAYER_PRIVATE_KEY"),
    backendSigningPrivateKey: requireEnv("BACKEND_SIGNING_PRIVATE_KEY"),
    documentMasterKey: requireEnv("DOCUMENT_MASTER_KEY"),
    databaseUrl: requireEnv("DATABASE_URL"),
    port: parseInt(process.env.PORT || "3000", 10),
    authDomain: requireEnv("AUTH_DOMAIN"),
  };

  // Explicit, deliberate check per BACKEND_SPEC.md: these two keys must
  // never be the same value. Conflating them was explicitly called out
  // as a mistake to guard against, not just a style preference.
  if (
    cachedConfig.relayerPrivateKey.toLowerCase() ===
    cachedConfig.backendSigningPrivateKey.toLowerCase()
  ) {
    throw new Error(
      "RELAYER_PRIVATE_KEY and BACKEND_SIGNING_PRIVATE_KEY must not be " +
        "the same value — they serve distinct purposes (on-chain " +
        "transaction signing vs. JWT/proof-bundle signing) and conflating " +
        "them defeats the separation documented in BACKEND_SPEC.md."
    );
  }

  return cachedConfig;
}

/**
 * For tests only: clears the cached config so getConfig() re-validates
 * against whatever process.env looks like at call time. Not used in
 * normal server operation.
 */
export function _resetConfigCacheForTests(): void {
  cachedConfig = null;
}

/**
 * Confirms that a contract actually exists at each configured address on
 * the CURRENT chain, and throws a clear, actionable error immediately if
 * not — rather than letting the server start "successfully" and only
 * fail later, deep inside a service call, with a cryptic ethers error
 * like:
 *
 *   could not decode result data (value="0x", ..., code=BAD_DATA)
 *
 * That error means the same thing every time: there is no contract
 * bytecode at that address on whatever chain the RPC endpoint is
 * currently serving. The most common cause in local development is
 * restarting `npx hardhat node` (including a machine sleep/reboot that
 * killed the process) — Hardhat's local chain has NO persistent state,
 * so every restart wipes all deployed contracts back to genesis, while
 * the addresses recorded in .env are unchanged from the previous chain
 * instance and now point at empty accounts.
 *
 * This check only validates SHAPE-independent liveness (does bytecode
 * exist at all) — it cannot detect a case where a different, unrelated
 * contract happens to be redeployed to the same address, which is why
 * getConfig()'s regex checks and this function are complementary, not
 * redundant: one validates the value LOOKS like an address, this one
 * validates a contract is ACTUALLY there right now.
 *
 * Call this once at process startup (see index.ts), after getConfig()
 * but before the server starts accepting requests.
 */
export async function verifyContractsDeployed(
  config: Config
): Promise<void> {
  // Deliberately require ethers here rather than at module top level:
  // config.ts is imported very early (before almost anything else, by
  // design — see the module comment above), and importing ethers only
  // inside this function keeps that early import light for any code
  // path that only needs getConfig()'s synchronous shape validation and
  // never calls this liveness check (e.g. a future CLI tool that only
  // needs to read config values).
  const { ethers } = await import("ethers");

  const provider = new ethers.JsonRpcProvider(
    config.hardhatRpcUrl
  );

  const addressesToCheck: Array<[string, string]> = [
    ["IDENTITY_REGISTRY_ADDRESS", config.identityRegistryAddress],
    ["ACCESS_CONTROL_ADDRESS", config.accessControlAddress],
    ["ASSET_REGISTRY_ADDRESS", config.assetRegistryAddress],
  ];

  const missing: string[] = [];

  for (const [name, address] of addressesToCheck) {
    let code: string;
    try {
      code = await provider.getCode(address);
    } catch (error) {
      throw new Error(
        `Could not reach the RPC endpoint at ${config.hardhatRpcUrl} ` +
          `while checking ${name} (${address}). Is a Hardhat node (or ` +
          `other RPC endpoint) actually running at that URL? ` +
          `Underlying error: ${
            error instanceof Error ? error.message : String(error)
          }`
      );
    }

    // getCode() returns the literal string "0x" (no bytecode) for any
    // address with nothing deployed there — including a perfectly
    // valid-looking address left over from a chain that no longer
    // exists.
    if (code === "0x") {
      missing.push(`${name} (${address})`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      "No contract found on-chain at the address(es) configured in " +
        ".env:\n" +
        missing.map((entry) => `  - ${entry}`).join("\n") +
        "\n\nThis almost always means the local Hardhat node was " +
        "restarted (or the machine slept/rebooted) since these " +
        "contracts were deployed — a restart wipes ALL chain state " +
        "back to genesis, and .env is not updated automatically " +
        "unless you redeploy.\n\n" +
        "Fix: from contracts/, with the Hardhat node running, run:\n" +
        "  npx hardhat run scripts/deploy.js --network localhost\n" +
        "deploy.js automatically rewrites backend/.env with the new " +
        "addresses — then restart the backend."
    );
  }
}
