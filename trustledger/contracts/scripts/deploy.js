const { ethers } = require("hardhat");

/// Deploys all three TrustLedger contracts in the strict, required order
/// documented in CONTRACTS_SPEC.md ("Cross-contract dependency"):
///
///   IdentityRegistry -> AccessControl -> AssetRegistry
///
/// AccessControl depends on IdentityRegistry (identity/role checks).
/// AssetRegistry depends on BOTH IdentityRegistry (identity/role checks)
/// AND AccessControl (TRANSFER permission checks in transferAsset) — so
/// it must be deployed last. This order is not optional or a convenience
/// — deploying out of order will fail, since each constructor requires
/// the previous contract's address.
async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying with account:", deployer.address);
  console.log(
    "Account balance:",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
    "ETH"
  );
  console.log("");

  // --- Bootstrap identity for the deployer (becomes the first ADMIN) ---
  //
  // These are LOCAL DEV BOOTSTRAP VALUES, not meaningful production
  // identity data. The DID follows the documented format
  // (did:trustledger:<address> — see DATA_MODEL.md). The public key is a
  // placeholder since this script does not perform real key generation;
  // if/when real challenge-response authentication is exercised against
  // this deployment, the bootstrap Admin's actual signing key must match
  // whatever public key is registered here — replace this placeholder
  // with a real one before using this deployment for any auth testing
  // that depends on the bootstrap Admin being able to sign a challenge.
  const bootstrapDID = `did:trustledger:${deployer.address}`;
  const bootstrapPublicKey = "0x00"; // placeholder — see note above

  // --- 1. IdentityRegistry ---
  console.log("1/3 Deploying IdentityRegistry...");
  const IdentityRegistry = await ethers.getContractFactory(
    "IdentityRegistry"
  );
  const identityRegistry = await IdentityRegistry.deploy(
    bootstrapDID,
    bootstrapPublicKey
  );
  await identityRegistry.waitForDeployment();
  const identityRegistryAddress = await identityRegistry.getAddress();
  console.log("    IdentityRegistry deployed to:", identityRegistryAddress);

  // --- 2. AccessControl (depends on IdentityRegistry) ---
  console.log("2/3 Deploying AccessControl...");
  const AccessControl = await ethers.getContractFactory("AccessControl");
  const accessControl = await AccessControl.deploy(identityRegistryAddress);
  await accessControl.waitForDeployment();
  const accessControlAddress = await accessControl.getAddress();
  console.log("    AccessControl deployed to:", accessControlAddress);

  // --- 3. AssetRegistry (depends on IdentityRegistry AND AccessControl) ---
  console.log("3/3 Deploying AssetRegistry...");
  const AssetRegistry = await ethers.getContractFactory("AssetRegistry");
  const assetRegistry = await AssetRegistry.deploy(
    identityRegistryAddress,
    accessControlAddress
  );
  await assetRegistry.waitForDeployment();
  const assetRegistryAddress = await assetRegistry.getAddress();
  console.log("    AssetRegistry deployed to:", assetRegistryAddress);

  console.log("");
  console.log("All three contracts deployed successfully.");
  console.log("");
  console.log("Bootstrap Admin identity:");
  console.log("    address:", deployer.address);
  console.log("    did:", bootstrapDID);
  console.log("");
  console.log(
    "Paste the following into backend/.env (see BACKEND_SPEC.md" +
      " Environment assumptions):"
  );
  console.log("---");
  console.log(`IDENTITY_REGISTRY_ADDRESS=${identityRegistryAddress}`);
  console.log(`ACCESS_CONTROL_ADDRESS=${accessControlAddress}`);
  console.log(`ASSET_REGISTRY_ADDRESS=${assetRegistryAddress}`);
  console.log("---");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
