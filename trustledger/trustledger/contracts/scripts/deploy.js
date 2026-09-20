const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

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

/// Every local Hardhat node restart (`npx hardhat node`, including a
/// machine sleep/reboot that killed the process) wipes ALL chain state
/// back to genesis. Contracts deployed before the restart no longer
/// exist on the new chain — CREATE-derived addresses are facts about a
/// specific chain's history, not stable configuration. Any stale
/// address left over in backend/.env from a previous chain instance
/// causes ethers calls to fail with something like:
///
///   could not decode result data (value="0x", ..., code=BAD_DATA)
///
/// which is Hardhat/ethers telling you there is no contract bytecode at
/// that address on the CURRENT chain. This function writes the
/// freshly-deployed addresses directly into backend/.env after every
/// deploy, so that step is never a manual, easy-to-forget copy-paste.
function writeAddressesToBackendEnv(addresses) {
  const envPath = path.resolve(
    __dirname,
    "..",
    "..",
    "backend",
    ".env"
  );

  if (!fs.existsSync(envPath)) {
    console.log("");
    console.log(
      `WARNING: ${envPath} does not exist — skipping .env auto-update.`
    );
    console.log(
      "Paste the addresses printed above into backend/.env manually."
    );
    return;
  }

  // Preserve the file's existing line-ending style (this project's
  // backend/.env is CRLF, consistent with Windows/PowerShell) instead
  // of normalizing to LF, which would silently rewrite every line
  // ending in the file on every deploy.
  const original = fs.readFileSync(envPath, "utf8");
  const usesCRLF = original.includes("\r\n");
  const newline = usesCRLF ? "\r\n" : "\n";

  // Normalize to \n for line-by-line processing, then re-join with the
  // detected newline style at the end.
  const lines = original.split(/\r\n|\n/);

  const replacements = {
    IDENTITY_REGISTRY_ADDRESS: addresses.identityRegistryAddress,
    ACCESS_CONTROL_ADDRESS: addresses.accessControlAddress,
    ASSET_REGISTRY_ADDRESS: addresses.assetRegistryAddress,
  };

  const foundKeys = new Set();

  const updatedLines = lines.map((line) => {
    for (const key of Object.keys(replacements)) {
      // Matches KEY=value, KEY="value", or KEY='value', with optional
      // surrounding whitespace, without touching comments (#...) or
      // unrelated lines that merely contain the key name as a
      // substring elsewhere.
      const lineRe = new RegExp(`^(\\s*)${key}\\s*=.*$`);
      if (lineRe.test(line)) {
        foundKeys.add(key);
        return `${key}="${replacements[key]}"`;
      }
    }
    return line;
  });

  // Any of the three keys that didn't already exist in the file get
  // appended, rather than silently dropped — a missing key should
  // never be a silent no-op.
  const missingKeys = Object.keys(replacements).filter(
    (key) => !foundKeys.has(key)
  );

  if (missingKeys.length > 0) {
    if (
      updatedLines.length > 0 &&
      updatedLines[updatedLines.length - 1] !== ""
    ) {
      updatedLines.push("");
    }
    for (const key of missingKeys) {
      updatedLines.push(`${key}="${replacements[key]}"`);
    }
  }

  const updatedContent = updatedLines.join(newline);

  fs.writeFileSync(envPath, updatedContent, "utf8");

  console.log("");
  console.log(`backend/.env updated automatically: ${envPath}`);
  if (missingKeys.length > 0) {
    console.log(
      `  (added missing keys: ${missingKeys.join(", ")})`
    );
  }
}

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
    "backend/.env is updated automatically below. If that failed for" +
      " any reason, paste these manually (see BACKEND_SPEC.md" +
      " Environment assumptions):"
  );
  console.log("---");
  console.log(`IDENTITY_REGISTRY_ADDRESS=${identityRegistryAddress}`);
  console.log(`ACCESS_CONTROL_ADDRESS=${accessControlAddress}`);
  console.log(`ASSET_REGISTRY_ADDRESS=${assetRegistryAddress}`);
  console.log("---");

  writeAddressesToBackendEnv({
    identityRegistryAddress,
    accessControlAddress,
    assetRegistryAddress,
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
