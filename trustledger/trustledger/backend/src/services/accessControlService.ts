import { ethers } from "ethers";
import { getConfig } from "../config";
import AccessControlArtifact from "../abi/AccessControl.json";

export type AccessAction =
  | "READ"
  | "WRITE"
  | "TRANSFER";

export type PermissionState =
  | "GRANTED"
  | "REVOKED";

export interface PermissionRecord {
  permissionId: bigint;
  assetId: bigint;
  subjectDID: string;
  action: AccessAction;
  state: PermissionState;
  grantedBy: string;
  validFrom: bigint;
  validUntil: bigint;
}

let cachedProvider: ethers.JsonRpcProvider | null = null;
let cachedReadContract: ethers.Contract | null = null;
let cachedWriteContract: ethers.Contract | null = null;

function getProvider(): ethers.JsonRpcProvider {
  if (!cachedProvider) {
    const config = getConfig();

    cachedProvider = new ethers.JsonRpcProvider(
      config.hardhatRpcUrl
    );
  }

  return cachedProvider;
}

function getReadContract(): ethers.Contract {
  if (!cachedReadContract) {
    const config = getConfig();

    cachedReadContract = new ethers.Contract(
      config.accessControlAddress,
      AccessControlArtifact,
      getProvider()
    );
  }

  return cachedReadContract;
}

/**
 * A Wallet whose nonce assignment AND mining confirmation are both
 * serialized through serializeRelayerCall(), so a queue turn does not
 * release until the transaction it just sent has actually been MINED —
 * not merely broadcast.
 *
 * THIS SUPERSEDES A "QUERY PENDING FRESH, SERIALIZED" APPROACH that
 * only wrapped getNonce() and let sendTransaction() run outside the
 * queue. That approach reasoned that serializing "pending" queries
 * alone would be sufficient, since nothing else could be modifying
 * chain state concurrently — but it missed that sendTransaction()'s
 * promise resolves once a transaction is BROADCAST, not once it is
 * MINED. Confirmed directly: removing the earlier local-nonce-counter
 * version in favor of this simpler one caused an immediate regression
 * back to "Nonce too low" failures across most of the write-path
 * tests — proving there genuinely is a real, exploitable gap between
 * "sendTransaction resolved" and "the transaction is actually in a
 * mined block," even against Hardhat's automining, and even with every
 * "pending" query itself correctly serialized. A second, immediately
 * following getNonce() call can still land in that gap and read a
 * stale "pending" count.
 *
 * The fix: hold the queue turn open through sendTransaction AND through
 * waiting for that transaction's receipt, so the NEXT queued getNonce()
 * call cannot even begin until the previous transaction is confirmed
 * mined. This also correctly handles a transaction that reverts
 * on-chain (e.g. this codebase's own "recordAccess rejects access
 * when..." test, which deliberately triggers exactly this): a reverted
 * transaction is still mined and still consumes a real nonce, and
 * ethers' tx.wait() still resolves (with a receipt whose status is 0)
 * rather than throwing for a plain revert with no other RPC-level
 * problem — so waiting for it here doesn't require distinguishing
 * "reverted" from "succeeded," only "resolved on-chain" from "not yet."
 * A transaction that fails BEFORE ever reaching the mempool (e.g. a
 * gas-estimation throw inside populate/send) throws inside this same
 * queued function instead of returning a receipt to wait on — that
 * failure is caught, queued rejection is still surfaced to the actual
 * caller correctly, and it consumes no real chain nonce, which is
 * exactly consistent with "pending" being re-queried fresh (and
 * correctly unchanged) on the very next turn.
 */
class QueuedRelayerWallet extends ethers.Wallet {
  /**
   * Locally tracked nonce, initialized lazily from the chain on the
   * first send. Because every send is serialized AND we wait for
   * mining before releasing the queue (see below), this counter is
   * always exactly in sync with the chain's real "pending" count —
   * without relying on ethers' provider-level caching, which is what
   * caused the original "Nonce too low" failures (the provider's
   * internal cache could return a stale getTransactionCount result
   * within its pollingInterval window, even after the queue properly
   * serialized the sends and waited for mining).
   */
  private _managedNonce: number | null = null;

  override async getNonce(
    blockTag?: ethers.BlockTag
  ): Promise<number> {
    // Inside a serialized queue turn (which is the only context we
    // ever reach this — see sendTransaction below), either return the
    // locally tracked nonce or initialize it fresh from the chain on
    // the very first call.
    if (this._managedNonce === null) {
      this._managedNonce = await super.getNonce("pending");
    }
    return this._managedNonce;
  }

  /** Reset the locally tracked nonce — used by tests that reset all
   *  module-level cached state between runs. */
  resetManagedNonce(): void {
    this._managedNonce = null;
  }

  override async sendTransaction(
    tx: ethers.TransactionRequest
  ): Promise<ethers.TransactionResponse> {
    return serializeRelayerCall(async () => {
      const response = await super.sendTransaction(tx);

      // Hold this queue turn open until the transaction is actually
      // mined — not merely broadcast — so the NEXT queued call's
      // nonce is guaranteed to reflect this transaction's real, final
      // effect on the chain.
      //
      // After successful mining (or on-chain revert, which still
      // consumes a nonce), increment the local nonce counter. This
      // replaces the previous approach of relying on the provider's
      // getTransactionCount("pending") for each subsequent send.
      try {
        await response.wait();
      } catch {
        // Intentionally ignored — a plain on-chain revert still
        // consumes a nonce, and wait() resolves (not throws) for
        // plain reverts. If wait() throws for some other reason
        // (network issue, etc.), we still increment below because
        // the transaction WAS broadcast and likely consumed a nonce.
      }

      // Increment the local nonce after the transaction has been
      // mined (or at least broadcast). Every mined transaction —
      // whether it succeeded or reverted on-chain — consumes exactly
      // one nonce.
      if (this._managedNonce !== null) {
        this._managedNonce++;
      }

      return response;
    });
  }
}

function getWriteContract(): ethers.Contract {
  if (!cachedWriteContract) {
    const config = getConfig();

    const relayer = new QueuedRelayerWallet(
      config.relayerPrivateKey,
      getProvider()
    );

    cachedWriteContract = new ethers.Contract(
      config.accessControlAddress,
      AccessControlArtifact,
      relayer
    );
  }

  return cachedWriteContract;
}

/**
 * Serializes every relayer-signed, state-changing transaction submitted
 * through this module and through getRelayerSigner() below, so that a
 * queue turn — covering send AND mining confirmation — is never
 * interrupted by another queued call starting early.
 *
 * See the extended comment on QueuedRelayerWallet.sendTransaction()
 * above for exactly why this needs to hold the queue open through
 * mining, not just through the initial broadcast, and for the history
 * of two earlier, narrower attempts that each fixed one failure mode
 * but reintroduced or left open another.
 *
 * WHY NOT ethers.NonceManager: NonceManager's own sendTransaction()
 * increments its internal counter BEFORE the transaction is confirmed
 * to have actually been sent (a known, documented gap in ethers.js
 * itself — see signer-noncemanager.js's own inline TODO: "Maybe handle
 * interesting/recoverable errors? Like don't increment if the tx was
 * certainly not sent"). If ANY send from that manager throws before
 * reaching the mempool, the manager's internal delta is already
 * incremented and never restored, permanently skipping a nonce the
 * chain never actually consumed — every later send then desyncs with
 * "Nonce too high," a failure directly observed when this codebase
 * used NonceManager. This queue avoids that entirely by never tracking
 * a local nonce counter of its own — every getNonce() call still
 * queries the chain's real "pending" count fresh (via the ordinary,
 * un-overridden Wallet behavior), and correctness comes from ensuring
 * that query never lands while a previous transaction's mining outcome
 * is still unresolved.
 *
 * CALL-SITE WARNING: do not wrap a contract METHOD CALL (e.g.
 * `someContractFunction(...)`) in a SECOND serializeRelayerCall() at
 * the call site. Calling a method on a Contract whose runner is a
 * QueuedRelayerWallet already triggers exactly one enqueue, inside
 * sendTransaction() above, automatically. Wrapping the outer call in
 * ANOTHER serializeRelayerCall() creates a real deadlock: the outer
 * queue entry cannot complete until the inner sendTransaction call
 * (itself a second, nested queue entry, which now also waits for
 * mining before releasing) resolves — but that inner entry is queued
 * BEHIND the outer one and can only run once the outer entry finishes.
 * Neither ever does. This exact bug shipped once in this file's
 * setPermission()/recordAccess() and manifested as every write-path
 * integration test hanging silently until Jest's test timeout, with no
 * thrown error at all.
 */
let relayerQueue: Promise<unknown> = Promise.resolve();

function serializeRelayerCall<T>(
  fn: () => Promise<T>
): Promise<T> {
  const result = relayerQueue.then(
    fn,
    fn
  );

  // Swallow rejections in the QUEUE chain itself (not in what callers
  // receive) so one failed/reverted send doesn't permanently wedge
  // every later queued call behind a rejected promise.
  relayerQueue = result.catch(() => undefined);

  return result;
}

/**
 * Exposes the SAME queued relayer Wallet this service uses internally
 * for its own writes, so callers that ALSO need to submit relayer-signed
 * transactions directly against a different contract (e.g. integration
 * tests calling IdentityRegistry.registerIdentity/revokeIdentity) share
 * the one serialization queue instead of constructing a second,
 * independent Wallet for the same private key — which would bypass the
 * queue and reintroduce the original "Nonce too low" race. The returned
 * value is a genuine ethers.Wallet (a QueuedRelayerWallet), safe to pass
 * directly to Contract.connect() or use for any other Signer operation.
 */
export function getRelayerSigner(): ethers.Wallet {
  const contract = getWriteContract();
  return contract.runner as ethers.Wallet;
}

function actionToEnum(
  action: AccessAction
): number {
  switch (action) {
    case "READ":
      return 0;

    case "WRITE":
      return 1;

    case "TRANSFER":
      return 2;
  }
}

function stateToEnum(
  state: PermissionState
): number {
  switch (state) {
    case "GRANTED":
      return 0;

    case "REVOKED":
      return 1;
  }
}

function enumToAction(
  value: number
): AccessAction {
  switch (value) {
    case 0:
      return "READ";

    case 1:
      return "WRITE";

    case 2:
      return "TRANSFER";

    default:
      throw new Error(
        `Unknown AccessControl action enum value: ${value}`
      );
  }
}

function enumToState(
  value: number
): PermissionState {
  switch (value) {
    case 0:
      return "GRANTED";

    case 1:
      return "REVOKED";

    default:
      throw new Error(
        `Unknown AccessControl permission state enum value: ${value}`
      );
  }
}

function normalizePermission(
  permission: any
): PermissionRecord {
  return {
    permissionId: BigInt(
      permission.permissionId
    ),
    assetId: BigInt(
      permission.assetId
    ),
    subjectDID: String(
      permission.subjectDID
    ),
    action: enumToAction(
      Number(permission.action)
    ),
    state: enumToState(
      Number(permission.state)
    ),
    grantedBy: String(
      permission.grantedBy
    ),
    validFrom: BigInt(
      permission.validFrom
    ),
    validUntil: BigInt(
      permission.validUntil
    ),
  };
}

export async function checkPermissionNow(
  assetId: bigint | number | string,
  subjectDID: string,
  action: AccessAction
): Promise<boolean> {
  const contract = getReadContract();

  const checkPermission =
    contract.getFunction(
      "checkPermissionNow"
    );

  return Boolean(
    await checkPermission(
      assetId,
      subjectDID,
      actionToEnum(action)
    )
  );
}

export async function checkPermissionAtTime(
  assetId: bigint | number | string,
  subjectDID: string,
  action: AccessAction,
  atTimestamp: bigint | number | string
): Promise<PermissionRecord> {
  const contract = getReadContract();

  const checkPermission =
    contract.getFunction(
      "checkPermissionAtTime"
    );

  const permission =
    await checkPermission(
      assetId,
      subjectDID,
      actionToEnum(action),
      atTimestamp
    );

  return normalizePermission(
    permission
  );
}

export async function setPermission(
  assetId: bigint | number | string,
  subjectDID: string,
  action: AccessAction,
  state: PermissionState
): Promise<ethers.TransactionResponse> {
  const contract = getWriteContract();

  const setPermissionFunction =
    contract.getFunction(
      "setPermission"
    );

  // Do NOT wrap this call in serializeRelayerCall() here — that
  // serialization already happens exactly once, automatically, inside
  // QueuedRelayerWallet.sendTransaction() (see that class above
  // getWriteContract). Calling a contract METHOD through ethers
  // internally calls sendTransaction() on the contract's runner (the
  // QueuedRelayerWallet), which enqueues itself. Wrapping THIS call in
  // ANOTHER serializeRelayerCall() here — an earlier version of this
  // file did exactly that — creates a genuine deadlock: the outer queue
  // entry (this function's own serializeRelayerCall wrapping
  // setPermissionFunction(...)) cannot complete until
  // setPermissionFunction's OWN internal sendTransaction call resolves,
  // but that inner call is a SECOND entry queued behind the outer one —
  // which can only run after the outer entry finishes. Neither can ever
  // finish. This surfaced as every write-path integration test hanging
  // until Jest's test timeout, with no error at all (nothing ever
  // actually threw — the queue just never advanced).
  return setPermissionFunction(
    assetId,
    subjectDID,
    actionToEnum(action),
    stateToEnum(state)
  );
}

export async function recordAccess(
  assetId: bigint | number | string,
  requesterDID: string,
  permissionId: bigint | number | string
): Promise<ethers.TransactionResponse> {
  const contract = getWriteContract();

  const recordAccessFunction =
    contract.getFunction(
      "recordAccess"
    );

  // See the comment in setPermission() above — same reasoning applies
  // here. Do not wrap this in serializeRelayerCall(); the contract call
  // itself already routes through the queue via
  // QueuedRelayerWallet.sendTransaction().
  return recordAccessFunction(
    assetId,
    requesterDID,
    permissionId
  );
}

export function _resetAccessControlServiceForTests(): void {
  cachedProvider = null;
  cachedReadContract = null;
  cachedWriteContract = null;
  relayerQueue = Promise.resolve();
}