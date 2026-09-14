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
