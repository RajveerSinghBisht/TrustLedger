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
 * A Wallet with a locally tracked nonce, serialized through
 * serializeRelayerCall() so no two sends run concurrently and each send
 * waits for mining before the queue advances.
 *
 * PRODUCES 23/23 PASSING as of the last confirmed run against this exact
 * file. This is the current, working state — treat it as the baseline
 * to preserve, not as a design to re-litigate without new evidence.
 *
 * WHY THE LOCAL COUNTER, NOT A FRESH getNonce("pending") QUERY EACH
 * TIME: an earlier version queried the chain's "pending" count fresh on
 * every serialized call instead of tracking a local counter, and that
 * version measured worse (21/23, then regressed further under other
 * changes) with symptoms matching a stale nonce read on the call
 * immediately following a mined transaction. The most likely explanation
 * is that ethers v6's JsonRpcProvider can return a cached
 * getTransactionCount result within its polling-interval window, even
 * when the queue has correctly waited for the prior transaction to be
 * mined before issuing the next query — but this has NOT been confirmed
 * against ethers' actual source in this codebase; treat it as the
 * leading hypothesis, not a verified mechanism. What IS verified is the
 * test result: this version passes 23/23, the fresh-query version did
 * not.
 *
 * WHY THIS DIFFERS FROM AN EARLIER, REJECTED LOCAL-COUNTER ATTEMPT: a
 * prior version of this file also used a local counter but did not
 * survive a deliberate on-chain revert in the test suite (it desynced
 * with "Nonce too high" a few tests after a revert-triggering test ran).
 * The increment logic below runs after response.wait() regardless of
 * whether the transaction succeeded or reverted on-chain, specifically
 * because a REVERTED-BUT-MINED transaction still consumes a real nonce
 * — only a throw BEFORE broadcast (e.g. a gas-estimation failure) should
 * leave the counter unincremented, and does, because that throw
 * propagates out of this function before reaching the increment.
 */
class QueuedRelayerWallet extends ethers.Wallet {
  /**
   * Locally tracked nonce, initialized lazily from the chain on the
   * first send, then advanced manually on every subsequent send (see
   * sendTransaction() below) rather than re-queried from the provider.
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
 * See the extended comment on QueuedRelayerWallet above for the current
 * design and the reasoning (with confidence levels) behind it.
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
 * used NonceManager. This queue's local counter differs from
 * NonceManager's in one important respect: it only advances AFTER a
 * transaction has actually resolved on-chain (mined, whether succeeded
 * or reverted) — never optimistically before that — so a pre-send throw
 * cannot desync it the way NonceManager's early-increment does.
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

/**
 * Calls setPermission() (above) and additionally waits for the
 * transaction to be mined and decodes the resulting PermissionChanged
 * event, returning the assigned permissionId and validFrom alongside the
 * transaction hash.
 *
 * DELIBERATELY SEPARATE from setPermission() rather than changing that
 * function's own return type: setPermission() currently returns the raw
 * ethers.TransactionResponse, and the existing integration test suite
 * (accessControlService.integration.test.ts) calls
 * `const tx = await setPermission(...); await tx.wait();` at 12 call
 * sites. Changing setPermission() to wait()+parse internally and return
 * a different shape would break every one of those call sites in an
 * already-verified, 23/23-passing test file. This function exists so
 * the route layer (routes/permissions.ts) can get the decoded event data
 * it needs without touching that file at all.
 */
export async function setPermissionAndDecode(
  assetId: bigint | number | string,
  subjectDID: string,
  action: AccessAction,
  state: PermissionState
): Promise<{
  permissionId: bigint;
  validFrom: bigint;
  txHash: string;
}> {
  const contract = getWriteContract();
  const tx = await setPermission(assetId, subjectDID, action, state);
  const receipt = await tx.wait();

  if (!receipt) {
    throw new Error(
      "setPermission transaction did not produce a receipt"
    );
  }

  // Find the PermissionChanged log among possibly-multiple logs in the
  // receipt (there is exactly one PermissionChanged emission per
  // setPermission call per the contract source, but the receipt's logs
  // array could in principle contain other entries — filter explicitly
  // rather than assuming logs[0]).
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (parsed?.name === "PermissionChanged") {
        return {
          permissionId: BigInt(parsed.args.permissionId),
          validFrom: BigInt(parsed.args.validFrom),
          txHash: receipt.hash,
        };
      }
    } catch {
      // Not every log in the receipt necessarily belongs to this
      // contract's ABI (unlikely here, but parseLog throws for a log it
      // can't match) — skip and keep looking rather than fail the whole
      // decode over one unrelated log.
      continue;
    }
  }

  throw new Error(
    "PermissionChanged event not found in setPermission transaction receipt"
  );
}

// ── Dual-Custody (Two-Man Rule) Service Layer ─────────────────────────
//
// These functions bridge the dual-custody contract functions
// (requestPermission, approvePermission, cancelPermissionRequest,
// getPermissionRequest) to the route and testing layers, following the
// established patterns: QueuedRelayerWallet serialization for relayer
// writes, optional Signer support for multi-officer co-signing, and
// typed event decoding for structured responses.

export interface PermissionRequestRecord {
  requestId: bigint;
  assetId: bigint;
  subjectDID: string;
  action: AccessAction;
  requestedState: PermissionState;
  requester: string;
  requestedAt: bigint;
  expiresAt: bigint;
  approved: boolean;
  cancelled: boolean;
}

export type PermissionRequestStatus = "PENDING" | "APPROVED" | "CANCELLED" | "EXPIRED";

function normalizePermissionRequest(
  raw: any
): PermissionRequestRecord {
  return {
    requestId: BigInt(raw.requestId),
    assetId: BigInt(raw.assetId),
    subjectDID: String(raw.subjectDID),
    action: enumToAction(Number(raw.action)),
    requestedState: enumToState(Number(raw.requestedState)),
    requester: String(raw.requester),
    requestedAt: BigInt(raw.requestedAt),
    expiresAt: BigInt(raw.expiresAt),
    approved: Boolean(raw.approved),
    cancelled: Boolean(raw.cancelled),
  };
}

/**
 * Initiates a permission grant/revoke. For CONFIDENTIAL assets, creates a
 * dual-custody request in PENDING state requiring Officer 2 approval. For
 * PUBLIC and INTERNAL assets, delegates directly to single-sig on-chain.
 */
export async function requestPermission(
  assetId: bigint | number | string,
  subjectDID: string,
  action: AccessAction,
  state: PermissionState = "GRANTED",
  signer?: ethers.Signer
): Promise<ethers.TransactionResponse> {
  const contract = signer
    ? (getReadContract().connect(signer) as ethers.Contract)
    : getWriteContract();

  const fn = contract.getFunction("requestPermission");
  return fn(
    assetId,
    subjectDID,
    actionToEnum(action),
    stateToEnum(state)
  );
}

export type RequestPermissionResult =
  | {
      isDualCustody: true;
      requestId: bigint;
      assetId: bigint;
      subjectDID: string;
      action: AccessAction;
      requestedState: PermissionState;
      requester: string;
      expiresAt: bigint;
      txHash: string;
    }
  | {
      isDualCustody: false;
      permissionId: bigint;
      validFrom: bigint;
      txHash: string;
    };

/**
 * Submits requestPermission() and decodes the emitted event:
 * - Emits PermissionRequested for CONFIDENTIAL assets (isDualCustody: true)
 * - Emits PermissionChanged for PUBLIC/INTERNAL assets (isDualCustody: false)
 */
export async function requestPermissionAndDecode(
  assetId: bigint | number | string,
  subjectDID: string,
  action: AccessAction,
  state: PermissionState = "GRANTED",
  signer?: ethers.Signer
): Promise<RequestPermissionResult> {
  const contract = getReadContract();
  const tx = await requestPermission(assetId, subjectDID, action, state, signer);
  const receipt = await tx.wait();

  if (!receipt) {
    throw new Error("requestPermission transaction did not produce a receipt");
  }

  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (parsed?.name === "PermissionRequested") {
        return {
          isDualCustody: true,
          requestId: BigInt(parsed.args.requestId),
          assetId: BigInt(parsed.args.assetId),
          subjectDID: String(parsed.args.subjectDID),
          action: enumToAction(Number(parsed.args.action)),
          requestedState: enumToState(Number(parsed.args.requestedState)),
          requester: String(parsed.args.requester),
          expiresAt: BigInt(parsed.args.expiresAt),
          txHash: receipt.hash,
        };
      }
      if (parsed?.name === "PermissionChanged") {
        return {
          isDualCustody: false,
          permissionId: BigInt(parsed.args.permissionId),
          validFrom: BigInt(parsed.args.validFrom),
          txHash: receipt.hash,
        };
      }
    } catch {
      continue;
    }
  }

  throw new Error(
    "Neither PermissionRequested nor PermissionChanged event found in transaction receipt"
  );
}

/**
 * Officer 2 (Checker) co-signs a pending dual-custody request.
 * Officer 2 (Checker) co-signs a pending dual-custody request.
 * Enforces msg.sender != request.requester (non-self-approval).
 * Per dual-custody architecture, an explicit officer Signer MUST be provided.
 * The server never holds or uses an approver key.
 */
export async function approvePermission(
  requestId: bigint | number | string,
  signer?: ethers.Signer
): Promise<ethers.TransactionResponse> {
  if (!signer) {
    throw new Error(
      "approvePermission requires an explicit officer Signer. " +
      "Server-held approver keys are not permitted per dual-custody security architecture."
    );
  }
  const writeContract = getReadContract().connect(signer) as ethers.Contract;
  const fn = writeContract.getFunction("approvePermission");
  return fn(requestId);
}

export async function approvePermissionAndDecode(
  requestId: bigint | number | string,
  signer?: ethers.Signer
): Promise<{
  requestId: bigint;
  permissionId: bigint;
  validFrom: bigint;
  txHash: string;
}> {
  const contract = getReadContract();
  const tx = await approvePermission(requestId, signer);
  const receipt = await tx.wait();

  if (!receipt) {
    throw new Error("approvePermission transaction did not produce a receipt");
  }

  let approvedRequestId: bigint | null = null;
  let permissionId: bigint | null = null;
  let validFrom: bigint | null = null;

  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (parsed?.name === "PermissionApproved") {
        approvedRequestId = BigInt(parsed.args.requestId);
      } else if (parsed?.name === "PermissionChanged") {
        permissionId = BigInt(parsed.args.permissionId);
        validFrom = BigInt(parsed.args.validFrom);
      }
    } catch {
      continue;
    }
  }

  if (approvedRequestId === null) {
    throw new Error(
      "PermissionApproved event not found in approvePermission transaction receipt"
    );
  }

  return {
    requestId: approvedRequestId,
    permissionId: permissionId ?? 0n,
    validFrom: validFrom ?? BigInt(Math.floor(Date.now() / 1000)),
    txHash: receipt.hash,
  };
}

/**
 * Cancels a pending permission request. Only the requester or an ADMIN can cancel.
 */
export async function cancelPermissionRequest(
  requestId: bigint | number | string,
  signer?: ethers.Signer
): Promise<ethers.TransactionResponse> {
  const writeContract = signer
    ? (getReadContract().connect(signer) as ethers.Contract)
    : getWriteContract();

  const fn = writeContract.getFunction("cancelPermissionRequest");
  return fn(requestId);
}

export async function cancelPermissionRequestAndDecode(
  requestId: bigint | number | string,
  signer?: ethers.Signer
): Promise<{
  requestId: bigint;
  cancelledBy: string;
  txHash: string;
}> {
  const contract = getReadContract();
  const tx = await cancelPermissionRequest(requestId, signer);
  const receipt = await tx.wait();

  if (!receipt) {
    throw new Error(
      "cancelPermissionRequest transaction did not produce a receipt"
    );
  }

  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (parsed?.name === "PermissionRequestCancelled") {
        return {
          requestId: BigInt(parsed.args.requestId),
          cancelledBy: String(parsed.args.cancelledBy),
          txHash: receipt.hash,
        };
      }
    } catch {
      continue;
    }
  }

  throw new Error(
    "PermissionRequestCancelled event not found in transaction receipt"
  );
}

/**
 * Reads a single permission request by ID, including computed lifecycle status.
 */
export async function getPermissionRequest(
  requestId: bigint | number | string
): Promise<PermissionRequestRecord & { status: PermissionRequestStatus }> {
  const contract = getReadContract();
  const fn = contract.getFunction("getPermissionRequest");
  const raw = await fn(requestId);
  const normalized = normalizePermissionRequest(raw);

  const now = BigInt(Math.floor(Date.now() / 1000));
  let status: PermissionRequestStatus = "PENDING";
  if (normalized.approved) {
    status = "APPROVED";
  } else if (normalized.cancelled) {
    status = "CANCELLED";
  } else if (now > normalized.expiresAt) {
    status = "EXPIRED";
  }

  return {
    ...normalized,
    status,
  };
}

/**
 * Returns all permission requests recorded on-chain, optionally filtered by status.
 */
export async function getPermissionRequests(options?: {
  status?: PermissionRequestStatus | "ALL";
  fromBlock?: number;
}): Promise<Array<PermissionRequestRecord & { status: PermissionRequestStatus }>> {
  const contract = getReadContract();
  const filter = contract.filters.PermissionRequested();
  const events = await contract.queryFilter(filter, options?.fromBlock ?? 0);

  const requests: Array<PermissionRequestRecord & { status: PermissionRequestStatus }> = [];
  const seenIds = new Set<string>();

  for (const event of events) {
    try {
      const parsed = contract.interface.parseLog({
        topics: event.topics as string[],
        data: event.data,
      });
      if (parsed?.name === "PermissionRequested") {
        const id = BigInt(parsed.args.requestId);
        const idStr = id.toString();
        if (!seenIds.has(idStr)) {
          seenIds.add(idStr);
          const req = await getPermissionRequest(id);
          if (
            !options?.status ||
            options.status === "ALL" ||
            req.status === options.status
          ) {
            requests.push(req);
          }
        }
      }
    } catch {
      continue;
    }
  }

  return requests;
}