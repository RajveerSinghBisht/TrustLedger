import { getConfig, _resetConfigCacheForTests } from "../config";

const VALID_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const VALID_ADDRESS_2 = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const VALID_ADDRESS_3 = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const VALID_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const VALID_PRIVATE_KEY_2 =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

function setValidEnv(overrides: Record<string, string | undefined> = {}) {
  const base = {
    HARDHAT_RPC_URL: "http://127.0.0.1:8545",
    IDENTITY_REGISTRY_ADDRESS: VALID_ADDRESS,
    ACCESS_CONTROL_ADDRESS: VALID_ADDRESS_2,
    ASSET_REGISTRY_ADDRESS: VALID_ADDRESS_3,
    RELAYER_PRIVATE_KEY: VALID_PRIVATE_KEY,
    BACKEND_SIGNING_PRIVATE_KEY: VALID_PRIVATE_KEY_2,
    DOCUMENT_MASTER_KEY: "some-random-master-key-value",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
    PORT: "3000",
    AUTH_DOMAIN: "trustledger.local",
    ...overrides,
  };

  for (const [key, value] of Object.entries(base)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("config", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    _resetConfigCacheForTests();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns a valid config when all required variables are set correctly", () => {
    setValidEnv();

    const config = getConfig();

    expect(config.hardhatRpcUrl).toBe("http://127.0.0.1:8545");
    expect(config.identityRegistryAddress).toBe(VALID_ADDRESS);
    expect(config.relayerPrivateKey).toBe(VALID_PRIVATE_KEY);
    expect(config.backendSigningPrivateKey).toBe(VALID_PRIVATE_KEY_2);
    expect(config.port).toBe(3000);
    expect(config.authDomain).toBe("trustledger.local");
  });

  it("throws a clear error when a required variable is missing entirely", () => {
    setValidEnv({ DATABASE_URL: undefined });

    expect(() => getConfig()).toThrow(
      "Missing required environment variable: DATABASE_URL"
    );
  });

  it("throws when a required variable is present but empty/whitespace", () => {
    setValidEnv({ AUTH_DOMAIN: "   " });

    expect(() => getConfig()).toThrow(
      "Missing required environment variable: AUTH_DOMAIN"
    );
  });

  it("rejects a malformed Ethereum address (wrong length)", () => {
    setValidEnv({ IDENTITY_REGISTRY_ADDRESS: "0x1234" });

    expect(() => getConfig()).toThrow(
      "IDENTITY_REGISTRY_ADDRESS does not look like a valid Ethereum address"
    );
  });

  it("rejects a malformed Ethereum address (missing 0x prefix)", () => {
    setValidEnv({
      ACCESS_CONTROL_ADDRESS: "e7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    });

    expect(() => getConfig()).toThrow(
      "ACCESS_CONTROL_ADDRESS does not look like a valid Ethereum address"
    );
  });

  it("rejects a malformed private key (wrong length)", () => {
    setValidEnv({ RELAYER_PRIVATE_KEY: "0xdeadbeef" });

    expect(() => getConfig()).toThrow(
      "RELAYER_PRIVATE_KEY does not look like a valid private key"
    );
  });

  it("does NOT apply the strict private-key shape check to BACKEND_SIGNING_PRIVATE_KEY", () => {
    // Per config.ts's own documented design: BACKEND_SIGNING_PRIVATE_KEY
    // is not required to be a real Ethereum-shaped key, only non-empty.
    setValidEnv({ BACKEND_SIGNING_PRIVATE_KEY: "any-random-string-works" });

    expect(() => getConfig()).not.toThrow();
  });

  it("CRITICAL: rejects when RELAYER_PRIVATE_KEY and BACKEND_SIGNING_PRIVATE_KEY are the same value", () => {
    setValidEnv({
      RELAYER_PRIVATE_KEY: VALID_PRIVATE_KEY,
      BACKEND_SIGNING_PRIVATE_KEY: VALID_PRIVATE_KEY,
    });

    expect(() => getConfig()).toThrow(
      "RELAYER_PRIVATE_KEY and BACKEND_SIGNING_PRIVATE_KEY must not be the same value"
    );
  });

  it("catches the key collision even with different casing", () => {
    setValidEnv({
      RELAYER_PRIVATE_KEY: VALID_PRIVATE_KEY.toLowerCase(),
      BACKEND_SIGNING_PRIVATE_KEY: VALID_PRIVATE_KEY.toUpperCase(),
    });

    expect(() => getConfig()).toThrow(
      "RELAYER_PRIVATE_KEY and BACKEND_SIGNING_PRIVATE_KEY must not be the same value"
    );
  });

  it("defaults PORT to 3000 when not set", () => {
    setValidEnv({ PORT: undefined });

    const config = getConfig();

    expect(config.port).toBe(3000);
  });

  it("caches the config after first successful call (does not re-read env on second call)", () => {
    setValidEnv();
    const first = getConfig();

    // Mutate env after first call — a cached config should NOT reflect this.
    process.env.AUTH_DOMAIN = "changed-after-first-call.local";

    const second = getConfig();

    expect(second.authDomain).toBe(first.authDomain);
    expect(second.authDomain).toBe("trustledger.local");
  });
});
