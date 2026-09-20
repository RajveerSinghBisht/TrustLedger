/// <reference types="jest" />

import { ethers } from "ethers";

import {
  checkPermissionNow,
  checkPermissionAtTime,
  setPermission,
  recordAccess,
  getRelayerSigner,
  _resetAccessControlServiceForTests,
} from "../accessControlService";

import {
  getConfig,
  _resetConfigCacheForTests,
} from "../../config";

import IdentityRegistryArtifact from "../../abi/IdentityRegistry.json";

const BOOTSTRAP_ADMIN_ADDRESS =
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const Action = {
  READ: 0,
  WRITE: 1,
  TRANSFER: 2,
} as const;

const PermissionState = {
  GRANTED: 0,
  REVOKED: 1,
} as const;

describe(
  "accessControlService (integration, real chain)",
  () => {
    let provider: ethers.JsonRpcProvider;
    let identityRegistry: ethers.Contract;
    // Single shared relayer signer for the WHOLE test file, reused from
    // accessControlService.ts itself (see getRelayerSigner() there). Do
    // NOT construct a separate `new ethers.Wallet(config.relayerPrivateKey,
    // ...)` anywhere in this file. getRelayerSigner() routes every send
    // through accessControlService.ts's internal serialization queue —
    // the same one setPermission/recordAccess use — guaranteeing no two
    // relayer-signed transactions are ever "in flight" (submitted but
    // unmined) at once, which is what a plain Wallet's per-send
    // eth_getTransactionCount(address, "pending") query needs to stay
    // accurate against a local automining Hardhat node.
    let relayer: ethers.Wallet;
    let identityRegistryWithRelayer: ethers.Contract;

    beforeAll(async () => {
      _resetConfigCacheForTests();
      _resetAccessControlServiceForTests();

      const config = getConfig();

      provider =
        new ethers.JsonRpcProvider(
          config.hardhatRpcUrl
        );

      identityRegistry =
        new ethers.Contract(
          config.identityRegistryAddress,
          IdentityRegistryArtifact.abi,
          provider
        );

      const network =
        await provider.getNetwork();

      expect(network.chainId).toBe(
        31337n
      );

      relayer = getRelayerSigner();

      const relayerAddress =
        await relayer.getAddress();

      identityRegistryWithRelayer =
        identityRegistry.connect(
          relayer
        ) as ethers.Contract;

      expect(
        relayerAddress.toLowerCase()
      ).toBe(
        BOOTSTRAP_ADMIN_ADDRESS.toLowerCase()
      );

      const isActiveFunction =
        identityRegistry.getFunction(
          "isActive"
        );

      const active =
        await isActiveFunction(
          relayerAddress
        );

      expect(active).toBe(true);

      const getRoleFunction =
        identityRegistry.getFunction(
          "getRole"
        );

      const role =
        await getRoleFunction(
          relayerAddress
        );

      expect(Number(role)).toBe(1);
    });

    afterAll(async () => {
      _resetAccessControlServiceForTests();
      _resetConfigCacheForTests();

      if (provider) {
        provider.destroy();
      }
    });

    async function createFreshSubject() {
      const subjectWallet =
        ethers.Wallet.createRandom();

      const subjectDID =
        `did:trustledger:integration-${subjectWallet.address}`;

      const registerIdentityFunction =
        identityRegistryWithRelayer.getFunction(
          "registerIdentity"
        );

      const tx =
        await registerIdentityFunction(
          subjectWallet.address,
          subjectDID,
          "0xbeef",
          4
        );

      await tx.wait();

      const resolveDIDFunction =
        identityRegistry.getFunction(
          "resolveDID"
        );

      const resolved =
        await resolveDIDFunction(
          subjectDID
        );

      expect(
        resolved.toLowerCase()
      ).toBe(
        subjectWallet.address.toLowerCase()
      );

      const isActiveFunction =
        identityRegistry.getFunction(
          "isActive"
        );

      const active =
        await isActiveFunction(
          subjectWallet.address
        );

      expect(active).toBe(true);

      return {
        subjectWallet,
        subjectDID,
      };
    }

    // Returns the timestamp of a specific mined block, OR of "latest" if
    // no block number is given. Prefer passing an explicit block number
    // (e.g. from a transaction receipt's blockNumber) whenever the
    // timestamp needs to correspond to a PARTICULAR transaction rather
    // than "whatever the chain tip happens to be right now" — this test
    // suite runs against a real, shared, automining Hardhat node, and
    // any other transaction (from this file, or from other test files
    // if Jest runs them with overlapping timing) landing between a
    // tx.wait() and a later separate "latest" query can advance the
    // chain tip past the block that actually matters, producing a
    // mismatched timestamp. This bit the "a later REVOKED version..."
    // test directly (validUntil off by ~1 mined block's worth of
    // evm_increaseTime).
    async function blockTimestamp(
      blockNumber?: number
    ): Promise<bigint> {
      const block =
        await provider.getBlock(
          blockNumber ?? "latest"
        );

      if (!block) {
        throw new Error(
          blockNumber === undefined
            ? "Unable to read latest Hardhat block"
            : `Unable to read Hardhat block #${blockNumber}`
        );
      }

      return BigInt(
        block.timestamp
      );
    }

    // Convenience: the timestamp of the block that actually mined a
    // given transaction, read from its OWN receipt rather than a
    // separate "latest" query made afterward. Use this instead of
    // blockTimestamp()/"latest" whenever the timestamp needs to
    // correspond to a specific transaction's effect (e.g. the
    // validFrom/validUntil a contract set inside that exact
    // transaction).
    async function timestampOfTx(
      tx: ethers.TransactionResponse
    ): Promise<bigint> {
      const receipt = await tx.wait();

      if (!receipt) {
        throw new Error(
          "Transaction receipt was null after wait()"
        );
      }

      return blockTimestamp(
        receipt.blockNumber
      );
    }

    test(
      "setPermission creates a real on-chain GRANTED permission and checkPermissionNow returns true",
      async () => {
        const {
          subjectDID,
        } = await createFreshSubject();

        const assetId =
          BigInt(
            Math.floor(
              Date.now() / 1000
            )
          );

        const tx =
          await setPermission(
            assetId,
            subjectDID,
            "READ",
            "GRANTED"
          );

        await tx.wait();

        const allowed =
          await checkPermissionNow(
            assetId,
            subjectDID,
            "READ"
          );

        expect(allowed).toBe(true);
      }
    );

    test(
      "checkPermissionNow returns false when no current permission exists",
      async () => {
        const {
          subjectDID,
        } = await createFreshSubject();

        const assetId =
          BigInt(
            Math.floor(
              Date.now() / 1000
            ) + 1
          );

        const allowed =
          await checkPermissionNow(
            assetId,
            subjectDID,
            "READ"
          );

        expect(allowed).toBe(false);
      }
    );

    test(
      "checkPermissionAtTime returns the actual on-chain permission record",
      async () => {
        const {
          subjectDID,
        } = await createFreshSubject();

        const assetId =
          BigInt(
            Math.floor(
              Date.now() / 1000
            ) + 2
          );

        const tx =
          await setPermission(
            assetId,
            subjectDID,
            "READ",
            "GRANTED"
          );

        const grantTimestamp =
          await timestampOfTx(tx);

        const permission =
          await checkPermissionAtTime(
            assetId,
            subjectDID,
            "READ",
            grantTimestamp
          );

        expect(
          permission.assetId
        ).toBe(assetId);

        expect(
          permission.subjectDID
        ).toBe(subjectDID);

        expect(
          permission.action
        ).toBe("READ");

        expect(
          permission.state
        ).toBe("GRANTED");

        expect(
          permission.permissionId
        ).toBeGreaterThan(0n);

        expect(
          permission.validFrom
        ).toBe(grantTimestamp);

        expect(
          permission.validUntil
        ).toBe(0n);

        expect(
          permission.grantedBy
        ).toBe(
          `did:trustledger:${BOOTSTRAP_ADMIN_ADDRESS}`
        );
      }
    );

    test(
      "a later REVOKED version makes current authorization false while preserving historical GRANTED authorization",
      async () => {
        const {
          subjectDID,
        } = await createFreshSubject();

        const assetId =
          BigInt(
            Math.floor(
              Date.now() / 1000
            ) + 3
          );

        const grantTx =
          await setPermission(
            assetId,
            subjectDID,
            "READ",
            "GRANTED"
          );

        const grantTimestamp =
          await timestampOfTx(grantTx);

        await provider.send(
          "evm_increaseTime",
          [3600]
        );

        await provider.send(
          "evm_mine",
          []
        );

        const revokeTx =
          await setPermission(
            assetId,
            subjectDID,
            "READ",
            "REVOKED"
          );

        const revokeReceipt =
          await revokeTx.wait();

        if (!revokeReceipt) {
          throw new Error(
            "revokeTx.wait() returned null receipt"
          );
        }

        // Read the timestamp from the BLOCK THAT ACTUALLY MINED
        // revokeTx, not from a separate "latest" query made afterward.
        // AccessControl.sol sets validUntil = block.timestamp at the
        // moment revokeTx itself executes. If ANY other transaction
        // (from this test file or Jest running other test files
        // concurrently against the same shared Hardhat node) gets mined
        // between revokeTx.wait() resolving and a later, separate
        // provider.getBlock("latest") call, "latest" can point past
        // revokeTx's own block — producing a validUntil that's earlier
        // than whatever "latest" timestamp the test captured, exactly
        // the ~1 second (or more, under evm_increaseTime) mismatch seen
        // here. Fetching the block by revokeReceipt.blockNumber pins
        // this to the exact block revokeTx landed in, regardless of
        // what else mines afterward.
        const revokeBlock =
          await provider.getBlock(
            revokeReceipt.blockNumber
          );

        if (!revokeBlock) {
          throw new Error(
            "Unable to read the block that mined revokeTx"
          );
        }

        const revokeTimestamp =
          BigInt(revokeBlock.timestamp);

        const currentAllowed =
          await checkPermissionNow(
            assetId,
            subjectDID,
            "READ"
          );

        expect(
          currentAllowed
        ).toBe(false);

        const historical =
          await checkPermissionAtTime(
            assetId,
            subjectDID,
            "READ",
            grantTimestamp
          );

        expect(
          historical.state
        ).toBe("GRANTED");

        expect(
          historical.validUntil
        ).toBe(revokeTimestamp);

        const currentRecord =
          await checkPermissionAtTime(
            assetId,
            subjectDID,
            "READ",
            revokeTimestamp
          );

        expect(
          currentRecord.state
        ).toBe("REVOKED");

        expect(
          currentRecord.validUntil
        ).toBe(0n);
      }
    );

    test(
      "historical permission lookup returns the safe REVOKED default before any permission existed",
      async () => {
        const {
          subjectDID,
        } = await createFreshSubject();

        const assetId =
          BigInt(
            Math.floor(
              Date.now() / 1000
            ) + 4
          );

        const beforePermission =
          await blockTimestamp();

        await provider.send(
          "evm_increaseTime",
          [100]
        );

        await provider.send(
          "evm_mine",
          []
        );

        const tx =
          await setPermission(
            assetId,
            subjectDID,
            "READ",
            "GRANTED"
          );

        await tx.wait();

        const historical =
          await checkPermissionAtTime(
            assetId,
            subjectDID,
            "READ",
            beforePermission
          );

        expect(
          historical.permissionId
        ).toBe(0n);

        expect(
          historical.state
        ).toBe("REVOKED");

        expect(
          historical.subjectDID
        ).toBe(subjectDID);
      }
    );

    test(
      "WRITE and TRANSFER actions are passed through to the real contract correctly",
      async () => {
        const {
          subjectDID,
        } = await createFreshSubject();

        const writeAssetId =
          BigInt(
            Math.floor(
              Date.now() / 1000
            ) + 5
          );

        const transferAssetId =
          BigInt(
            Math.floor(
              Date.now() / 1000
            ) + 6
          );

        const writeTx =
          await setPermission(
            writeAssetId,
            subjectDID,
            "WRITE",
            "GRANTED"
          );

        await writeTx.wait();

        const transferTx =
          await setPermission(
            transferAssetId,
            subjectDID,
            "TRANSFER",
            "GRANTED"
          );

        await transferTx.wait();

        const writeAllowed =
          await checkPermissionNow(
            writeAssetId,
            subjectDID,
            "WRITE"
          );

        const transferAllowed =
          await checkPermissionNow(
            transferAssetId,
            subjectDID,
            "TRANSFER"
          );

        expect(writeAllowed).toBe(true);
        expect(
          transferAllowed
        ).toBe(true);

        const readOnWriteAsset =
          await checkPermissionNow(
            writeAssetId,
            subjectDID,
            "READ"
          );

        expect(
          readOnWriteAsset
        ).toBe(false);
      }
    );

    test(
      "recordAccess emits the real AssetAccessed event after a currently authorized READ permission",
      async () => {
        const {
          subjectDID,
        } = await createFreshSubject();

        const assetId =
          BigInt(
            Math.floor(
              Date.now() / 1000
            ) + 7
          );

        const permissionTx =
          await setPermission(
            assetId,
            subjectDID,
            "READ",
            "GRANTED"
          );

        const permissionTimestamp =
          await timestampOfTx(permissionTx);

        const permission =
          await checkPermissionAtTime(
            assetId,
            subjectDID,
            "READ",
            permissionTimestamp
          );

        expect(
          permission.state
        ).toBe("GRANTED");

        const accessTx =
          await recordAccess(
            assetId,
            subjectDID,
            permission.permissionId
          );

        const receipt =
          await accessTx.wait();

        expect(receipt).not.toBeNull();

        const accessContract =
          new ethers.Contract(
            getConfig().accessControlAddress,
            [
              "event AssetAccessed(uint256 indexed assetId,string requesterDID,uint256 permissionId,uint256 timestamp)",
            ],
            provider
          );

        const events =
          await accessContract.queryFilter(
            // Only `assetId` is `indexed` on the real AssetAccessed
            // event (see AccessControl.sol) — `requesterDID` and
            // `permissionId` live in the log's data payload, not its
            // topics, so they CANNOT be passed to a topic filter.
            // Passing them here throws "cannot filter non-indexed
            // parameters" at the ethers ABI-encoding layer, before any
            // RPC call is even made. Filter on assetId only; verify
            // requesterDID/permissionId by inspecting the decoded event
            // below instead.
            accessContract.filters.AssetAccessed(
              assetId
            )
          );

        expect(
          events.length
        ).toBeGreaterThan(0);

        const matchingEvent =
          events[events.length - 1];

        const parsed =
          accessContract.interface.parseLog({
            topics:
              matchingEvent.topics,
            data:
              matchingEvent.data,
          });

        expect(parsed).not.toBeNull();

        expect(
          parsed?.args.assetId
        ).toBe(assetId);

        expect(
          parsed?.args.requesterDID
        ).toBe(subjectDID);

        expect(
          parsed?.args.permissionId
        ).toBe(
          permission.permissionId
        );
      }
    );

    test(
      "recordAccess rejects access when the current READ permission has been revoked",
      async () => {
        const {
          subjectDID,
        } = await createFreshSubject();

        const assetId =
          BigInt(
            Math.floor(
              Date.now() / 1000
            ) + 8
          );

        const grantTx =
          await setPermission(
            assetId,
            subjectDID,
            "READ",
            "GRANTED"
          );

        const grantTimestamp =
          await timestampOfTx(grantTx);

        const grantRecord =
          await checkPermissionAtTime(
            assetId,
            subjectDID,
            "READ",
            grantTimestamp
          );

        const revokeTx =
          await setPermission(
            assetId,
            subjectDID,
            "READ",
            "REVOKED"
          );

        await revokeTx.wait();

        const allowed =
          await checkPermissionNow(
            assetId,
            subjectDID,
            "READ"
          );

        expect(allowed).toBe(false);

        // Deliberately NOT using `.rejects.toThrow(...)` here: ethers.js
        // v6 attaches the original call arguments (including this
        // test's `bigint assetId`) to the thrown error object for
        // debugging. If the assertion doesn't match, Jest's worker
        // process tries to serialize that error — including the BigInt
        // field — across its IPC channel back to the main process using
        // JSON.stringify, which cannot serialize BigInt at all and
        // crashes the whole worker with "Do not know how to serialize a
        // BigInt" instead of reporting the real assertion failure. Catch
        // the rejection manually and assert on a plain string extracted
        // from it instead, so no BigInt-bearing object ever reaches
        // Jest's serializer.
        let caughtError: unknown;
        try {
          await recordAccess(
            assetId,
            subjectDID,
            grantRecord.permissionId
          );
        } catch (error) {
          caughtError = error;
        }

        expect(caughtError).toBeDefined();
        const message =
          caughtError instanceof Error
            ? caughtError.message
            : String(caughtError);
        expect(message).toContain(
          "AccessControl: access not currently authorized"
        );
      }
    );

    test(
      "revoking the subject identity immediately removes current access",
      async () => {
        const {
          subjectWallet,
          subjectDID,
        } = await createFreshSubject();

        const assetId =
          BigInt(
            Math.floor(
              Date.now() / 1000
            ) + 9
          );

        const grantTx =
          await setPermission(
            assetId,
            subjectDID,
            "READ",
            "GRANTED"
          );

        await grantTx.wait();

        const beforeRevocation =
          await checkPermissionNow(
            assetId,
            subjectDID,
            "READ"
          );

        expect(
          beforeRevocation
        ).toBe(true);

        const revokeIdentityFunction =
          identityRegistryWithRelayer.getFunction(
            "revokeIdentity"
          );

        const revokeIdentityTx =
          await revokeIdentityFunction(
            subjectWallet.address
          );

        await revokeIdentityTx.wait();

        const afterRevocation =
          await checkPermissionNow(
            assetId,
            subjectDID,
            "READ"
          );

        expect(
          afterRevocation
        ).toBe(false);
      }
    );

    test(
      "historical permission remains GRANTED after later identity revocation",
      async () => {
        const {
          subjectWallet,
          subjectDID,
        } = await createFreshSubject();

        const assetId =
          BigInt(
            Math.floor(
              Date.now() / 1000
            ) + 10
          );

        const grantTx =
          await setPermission(
            assetId,
            subjectDID,
            "READ",
            "GRANTED"
          );

        const grantTimestamp =
          await timestampOfTx(grantTx);

        const revokeIdentityFunction =
          identityRegistryWithRelayer.getFunction(
            "revokeIdentity"
          );

        const revokeIdentityTx =
          await revokeIdentityFunction(
            subjectWallet.address
          );

        await revokeIdentityTx.wait();

        const currentAllowed =
          await checkPermissionNow(
            assetId,
            subjectDID,
            "READ"
          );

        expect(
          currentAllowed
        ).toBe(false);

        const historical =
          await checkPermissionAtTime(
            assetId,
            subjectDID,
            "READ",
            grantTimestamp
          );

        expect(
          historical.state
        ).toBe("GRANTED");
      }
    );

    test(
      "permission enum values match the verified contract definitions",
      () => {
        expect(Action.READ).toBe(0);
        expect(Action.WRITE).toBe(1);
        expect(Action.TRANSFER).toBe(2);

        expect(
          PermissionState.GRANTED
        ).toBe(0);

        expect(
          PermissionState.REVOKED
        ).toBe(1);
      }
    );
  }
);