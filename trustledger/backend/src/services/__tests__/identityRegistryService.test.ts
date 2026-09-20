import { _resetConfigCacheForTests } from "../../config";

// Deliberately NOT importing `ethers` directly in this file, even though
// the zero-address constant would be convenient. Verified by actually
// running this suite: a top-level `import { ethers } from "ethers"` in
// the SAME file that also calls jest.mock("ethers", ...) breaks the
// mock — ts-jest/Babel's import hoisting does not correctly rebind that
// local `ethers` reference to the mock factory's return value when the
// module is imported directly by the test file itself (as opposed to
// only by the module under test). The symptom was silent: `is mock:
// false` and a real, unmocked ethers.JsonRpcProvider constructor,
// which either attempted a live network call (hang/timeout) or threw
// "not a constructor" depending on how far it got. Confirmed by
// reproducing it in isolation before writing this comment. Using a
// hardcoded zero-address literal below avoids the whole class of bug.
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Mock ethers BEFORE importing the service under test, so the service's
// own `new ethers.Contract(...)` call picks up the mocked constructor.
// JsonRpcProvider is also mocked — these unit tests must not attempt any
// real network connection; that is what the separate integration test
// (step 8) is for, against a real running Hardhat node.
//
// IMPORTANT, verified by actually running these tests (they hung/failed
// against a real network before this was found): ethers v6's CommonJS
// build exports a nested `exports.ethers = {...}` namespace object
// (lib.commonjs/ethers.js), which is a DIFFERENT object identity from
// the module's top-level named exports. `import { ethers } from "ethers"`
// — as used both here and in the service — resolves to that nested
// object. A mock factory that spreads jest.requireActual("ethers") and
// overrides top-level properties does NOT intercept calls made through
// the `ethers.` namespace the service actually uses; a real
// JsonRpcProvider still gets constructed and attempts a live network
// connection to HARDHAT_RPC_URL, which is why this needs to explicitly
// mock the nested `ethers` object shape below, not the flat module shape.
// jest.mock(...) calls are hoisted above regular const/let declarations
// by ts-jest/babel-jest, so the mock functions referenced inside the
// factory below must be created with `var` (also hoisted) rather than
// `const` — a `const` here throws "Cannot access before initialization"
// (verified by actually running this file; see comment further down for
// how the earlier version of this file's mock shape was also wrong).
var mockResolveDID = jest.fn();
var mockIsActive = jest.fn();
var mockGetRole = jest.fn();
var mockContractCtor = jest.fn().mockImplementation(() => ({
  resolveDID: mockResolveDID,
  isActive: mockIsActive,
  getRole: mockGetRole,
}));
var mockJsonRpcProviderCtor = jest.fn().mockImplementation(() => ({}));
// Added when identityRegistryService.ts gained write functions
// (registerIdentity) that import getRelayerSigner from
// accessControlService.ts. accessControlService.ts's module body
// defines `class QueuedRelayerWallet extends ethers.Wallet` at load
// time — so as soon as ANY test imports identityRegistryService.ts,
// accessControlService.ts is pulled into the module graph too, and
// `ethers.Wallet` must exist on this mock or that class definition
// itself throws ("Class extends value undefined is not a constructor")
// before any test in this file even runs. This mock class only needs to
// be extendable — nothing in THIS file's tests exercises relayer writes
// (see the separate identities.integration.test.ts for that coverage
// against a real chain) — so an empty extendable stub is sufficient.
var MockWallet = class {};

jest.mock("ethers", () => ({
  ethers: {
    JsonRpcProvider: mockJsonRpcProviderCtor,
    Contract: mockContractCtor,
    Wallet: MockWallet,
    ZeroAddress: "0x0000000000000000000000000000000000000000",
  },
}));

// Import AFTER the mock is set up.
import {
  resolveDID,
  isActive,
  resolveActiveIdentity,
  _resetIdentityRegistryServiceForTests,
} from "../identityRegistryService";

const VALID_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const OTHER_VALID_ADDRESS = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const OTHER_VALID_ADDRESS_2 = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
const VALID_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const VALID_PRIVATE_KEY_2 =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

function setValidEnv() {
  process.env.HARDHAT_RPC_URL = "http://127.0.0.1:8545";
  process.env.IDENTITY_REGISTRY_ADDRESS = VALID_ADDRESS;
  process.env.ACCESS_CONTROL_ADDRESS = OTHER_VALID_ADDRESS;
  process.env.ASSET_REGISTRY_ADDRESS = OTHER_VALID_ADDRESS_2;
  process.env.RELAYER_PRIVATE_KEY = VALID_PRIVATE_KEY;
  process.env.BACKEND_SIGNING_PRIVATE_KEY = VALID_PRIVATE_KEY_2;
  process.env.DOCUMENT_MASTER_KEY = "some-random-master-key-value";
  process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
  process.env.PORT = "3000";
  process.env.AUTH_DOMAIN = "trustledger.local";
}

describe("identityRegistryService", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    setValidEnv();
    _resetConfigCacheForTests();
    _resetIdentityRegistryServiceForTests();
    mockResolveDID.mockReset();
    mockIsActive.mockReset();
    mockGetRole.mockReset();
    mockContractCtor.mockClear();
    mockJsonRpcProviderCtor.mockClear();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe("resolveDID", () => {
    it("returns the resolved address for a known DID", async () => {
      mockResolveDID.mockResolvedValue(OTHER_VALID_ADDRESS);

      const result = await resolveDID("did:trustledger:known");

      expect(result).toBe(OTHER_VALID_ADDRESS);
      expect(mockResolveDID).toHaveBeenCalledWith("did:trustledger:known");
    });

    it("returns the zero address for an unknown DID, without throwing", async () => {
      // Per IdentityRegistry.sol: unknown DID -> address(0), not a revert.
      mockResolveDID.mockResolvedValue(ZERO_ADDRESS);

      const result = await resolveDID("did:trustledger:unknown");

      expect(result).toBe(ZERO_ADDRESS);
    });

    it("propagates a genuine provider/contract-call failure", async () => {
      // Distinguish: an RPC/network failure IS an error and should
      // reject, unlike the "unknown DID" case above which resolves
      // normally to the zero address.
      mockResolveDID.mockRejectedValue(new Error("network error"));

      await expect(resolveDID("did:trustledger:x")).rejects.toThrow(
        "network error"
      );
    });
  });

  describe("isActive", () => {
    it("returns true for an active identity", async () => {
      mockIsActive.mockResolvedValue(true);

      const result = await isActive(VALID_ADDRESS);

      expect(result).toBe(true);
      expect(mockIsActive).toHaveBeenCalledWith(VALID_ADDRESS);
    });

    it("returns false for a revoked identity", async () => {
      mockIsActive.mockResolvedValue(false);

      const result = await isActive(VALID_ADDRESS);

      expect(result).toBe(false);
    });

    it("returns false for a never-registered address (no revert)", async () => {
      // Per IdentityRegistry.sol: isActive does not distinguish
      // "never registered" from "revoked" -- both return false.
      mockIsActive.mockResolvedValue(false);

      const result = await isActive(OTHER_VALID_ADDRESS);

      expect(result).toBe(false);
    });
  });

  describe("getRole", () => {
    it("returns the numeric on-chain enum value", async () => {
      mockGetRole.mockResolvedValue(2);

      const { getRole } = await import("../identityRegistryService");
      await expect(getRole(VALID_ADDRESS)).resolves.toBe(2);
      expect(mockGetRole).toHaveBeenCalledWith(VALID_ADDRESS);
    });
  });

  describe("resolveActiveIdentity", () => {
    it("returns known:false, active:false for an unknown DID without calling isActive", async () => {
      mockResolveDID.mockResolvedValue(ZERO_ADDRESS);

      const result = await resolveActiveIdentity("did:trustledger:unknown");

      expect(result).toEqual({
        address: ZERO_ADDRESS,
        known: false,
        active: false,
      });
      // isActive on the zero address is meaningless -- must not be called.
      expect(mockIsActive).not.toHaveBeenCalled();
    });

    it("returns known:true, active:true for a known, active DID", async () => {
      mockResolveDID.mockResolvedValue(VALID_ADDRESS);
      mockIsActive.mockResolvedValue(true);

      const result = await resolveActiveIdentity("did:trustledger:known");

      expect(result).toEqual({
        address: VALID_ADDRESS,
        known: true,
        active: true,
      });
      expect(mockIsActive).toHaveBeenCalledWith(VALID_ADDRESS);
    });

    it("returns known:true, active:false for a known but revoked DID", async () => {
      mockResolveDID.mockResolvedValue(VALID_ADDRESS);
      mockIsActive.mockResolvedValue(false);

      const result = await resolveActiveIdentity("did:trustledger:revoked");

      expect(result).toEqual({
        address: VALID_ADDRESS,
        known: true,
        active: false,
      });
    });
  });

  describe("contract wiring", () => {
    it("instantiates ethers.Contract with the configured address and the real artifact ABI", async () => {
      mockResolveDID.mockResolvedValue(ZERO_ADDRESS);

      await resolveDID("did:trustledger:x");

      expect(mockContractCtor).toHaveBeenCalledWith(
        VALID_ADDRESS, // IDENTITY_REGISTRY_ADDRESS from env
        expect.arrayContaining([
          expect.objectContaining({ name: "resolveDID", type: "function" }),
          expect.objectContaining({ name: "isActive", type: "function" }),
        ]),
        expect.anything()
      );
    });

    it("caches the contract instance across calls (does not re-instantiate every call)", async () => {
      mockResolveDID.mockResolvedValue(ZERO_ADDRESS);

      await resolveDID("did:trustledger:a");
      await resolveDID("did:trustledger:b");

      expect(mockContractCtor).toHaveBeenCalledTimes(1);
    });
  });
});
