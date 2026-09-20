import {
  resolveDID,
  isActive,
  resolveActiveIdentity,
  _resetIdentityRegistryServiceForTests,
} from "../identityRegistryService";
import { _resetConfigCacheForTests } from "../../config";

/**
 * Integration test — deliberately uses NO ethers mock. This talks to a
 * real Hardhat node over real JSON-RPC and reads real on-chain state
 * from a real deployed IdentityRegistry.
 *
 * PREREQUISITES (this test will fail, correctly, if these aren't true —
 * it is not this test's job to start these for you):
 *   1. `npx hardhat node` running in contracts/, reachable at the
 *      HARDHAT_RPC_URL in backend/.env (default http://127.0.0.1:8545).
 *   2. `npx hardhat run scripts/deploy.js --network localhost` already
 *      run against that node, so IdentityRegistry actually exists at
 *      the address in IDENTITY_REGISTRY_ADDRESS.
 *   3. backend/.env populated with the real addresses deploy.js printed.
 *
 * The bootstrap identity values below (DID format, deployer address)
 * are NOT invented — they come directly from a real deploy run:
 *   bootstrap DID:      did:trustledger:<deployer address, checksummed>
 *   deployer address:   Hardhat's default Account #0
 *     0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
 * per scripts/deploy.js, which derives the DID as
 * `did:trustledger:${deployer.address}` — this is DIFFERENT from the
 * contract *unit test* fixture's BOOTSTRAP_DID constant
 * ("did:trustledger:bootstrap"), which is a separate, hardcoded value
 * only used inside contracts/test/IdentityRegistry.test.js's own fresh
 * deployments. Do not confuse the two — this integration test targets
 * whatever a real `deploy.js` run against your currently-running node
 * actually produced, not the unit test's fixture string.
 *
 * If you redeploy (restart the node and rerun deploy.js), Hardhat's
 * deterministic account derivation means Account #0's address will be
 * identical, so this bootstrap DID string remains stable across
 * redeploys as long as you're still using the default Hardhat mnemonic
 * and haven't changed the account ordering.
 */

const BOOTSTRAP_ADMIN_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const BOOTSTRAP_DID = `did:trustledger:${BOOTSTRAP_ADMIN_ADDRESS}`;
const DEFINITELY_UNREGISTERED_DID = "did:trustledger:definitely-nobody-xyz";

describe("identityRegistryService (integration, real chain)", () => {
  beforeEach(() => {
    _resetConfigCacheForTests();
    _resetIdentityRegistryServiceForTests();
  });

  it("resolves the real bootstrap admin DID to the real deployer address", async () => {
    const address = await resolveDID(BOOTSTRAP_DID);
    expect(address).toBe(BOOTSTRAP_ADMIN_ADDRESS);
  });

  it("reports the real bootstrap admin as active", async () => {
    const active = await isActive(BOOTSTRAP_ADMIN_ADDRESS);
    expect(active).toBe(true);
  });

  it("returns the zero address for a DID that was never registered on this real chain", async () => {
    const address = await resolveDID(DEFINITELY_UNREGISTERED_DID);
    expect(address).toBe("0x0000000000000000000000000000000000000000");
  });

  it("resolveActiveIdentity combines both real calls correctly for the real bootstrap admin", async () => {
    const result = await resolveActiveIdentity(BOOTSTRAP_DID);
    expect(result).toEqual({
      address: BOOTSTRAP_ADMIN_ADDRESS,
      known: true,
      active: true,
    });
  });

  it("resolveActiveIdentity short-circuits correctly for a genuinely unknown DID on this real chain", async () => {
    const result = await resolveActiveIdentity(DEFINITELY_UNREGISTERED_DID);
    expect(result).toEqual({
      address: "0x0000000000000000000000000000000000000000",
      known: false,
      active: false,
    });
  });
});
