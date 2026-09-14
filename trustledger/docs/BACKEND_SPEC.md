# Backend API Specification

Read `DATA_MODEL.md` first. This backend is the layer between the frontend
(built later), the smart contracts (see `CONTRACTS_SPEC.md`), and Postgres.
It does NOT contain business logic that belongs on-chain — permission
enforcement, role checks, and ownership rules live in the contracts. The
backend's job: authenticate identities, hash/encrypt files, call contracts,
store/retrieve off-chain data, and generate/verify proof bundles.

## Stack (locked)

- Node.js + TypeScript
- Express (or Fastify if you strongly prefer — confirm with the team first)
- `ethers.js` (v6) to talk to the deployed contracts
- `pg` or Prisma for PostgreSQL access — Prisma is recommended for speed of
  development, but either is acceptable
- Standard Node `crypto` module for AES-256-GCM and SHA-256 — do not add a
  third-party crypto library, the built-in module covers everything needed
- A JWT library (e.g. `jsonwebtoken`) for session tokens — see Section on
  Authentication below

## Environment / connection assumptions

The backend connects to a **local Hardhat network** (see CONTRACTS_SPEC.md —
this is not a testnet in this phase). Expect a `.env` with:

```
HARDHAT_RPC_URL=http://127.0.0.1:8545
IDENTITY_REGISTRY_ADDRESS=<filled in after contracts are deployed locally>
ACCESS_CONTROL_ADDRESS=<filled in after contracts are deployed locally>
ASSET_REGISTRY_ADDRESS=<filled in after contracts are deployed locally>
RELAYER_PRIVATE_KEY=<a real blockchain account key — one of the funded
                      Hardhat local accounts for this phase (see
                      contracts/scripts/deploy.js output). Used to sign
                      EVERY state-changing contract transaction this
                      backend submits (registerIdentity, setPermission,
                      registerAsset, transferAsset, etc.). This is a
                      distinct key from BACKEND_SIGNING_PRIVATE_KEY below
                      — do not conflate them. The address derived from
                      this key is what every contract's on-chain
                      modifier (onlyActiveAdmin, etc.) actually sees as
                      msg.sender for every relayed write — see
                      "Authorization Trust Boundary" below for why this
                      matters and what it does NOT guarantee. For this
                      MVP, this should be an address already registered
                      as ADMIN in IdentityRegistry (e.g. the bootstrap
                      Admin from deployment) so relayed privileged writes
                      succeed at the contract level; the backend's own
                      fresh-role-check (see below) is what enforces the
                      REAL actor's authorization, not this key's role>
BACKEND_SIGNING_PRIVATE_KEY=<used for BOTH JWT signing and proof-bundle
                              signing — NOT a blockchain account key, and
                              NOT the same key as RELAYER_PRIVATE_KEY
                              above. This key never touches the chain>
DOCUMENT_MASTER_KEY=<used ONLY to wrap/unwrap per-asset data encryption
                      keys — see Key Management below; never stored in
                      Postgres, never written to the blockchain>
DATABASE_URL=<postgres connection string>
```

The contract addresses won't exist until the contracts teammate has deployed
locally and shared them — until then, build against a mocked/stubbed
contract-interaction layer so you're not blocked. Structure your code so the
real contract calls are isolated in one module (e.g. `src/services/chain.ts`)
that's easy to swap from mock to real.

## Authentication — Challenge-Response with JWT Session Token

**This replaces an earlier, insecure design.** An earlier draft of this spec
had protected endpoints trust a client-supplied `X-Requester-DID` header as
the caller's identity. That is NOT authentication — any client can set any
value in a request header regardless of whether they control that identity's
private key. This section defines the corrected design. It is a MANDATORY
MVP requirement, not an optional hardening step.

### Flow

```
POST /api/auth/challenge
  Request:  { "did": "did:trustledger:0xABC..." }
  Response: { "message": "<canonical signable text>", "expiresAt": "<ISO timestamp>" }
```

Before issuing a challenge, the server resolves `did` to its registered
address via `IdentityRegistry.resolveDID()` — reject (404) if the DID is
unknown (`resolveDID` returns `address(0)`).

The server stores a challenge record:
```
{ nonce, did, expectedAddress, issuedAt, expiresAt, consumed: false }
```
`expectedAddress` is the address `resolveDID(did)` returned — not merely
the DID string. Binding to the expected address (not just the DID)
matters because it makes the verify step's job explicit: recover an
address from the signature, and require that EXACT address to match
`expectedAddress`, rather than inferring correctness indirectly from
DID-string equality alone.

**Canonical signable message (domain-separated — do not sign a bare
nonce):** the server constructs a structured, human-readable message and
returns it in the challenge response. The client's wallet signs this
exact text. This is plain structured text, not full EIP-712 typed-data
signing — a deliberate MVP tradeoff (EIP-712 gives a standardized,
wallet-native typed-data mechanism; plain structured text is faster to
implement and sufficiently domain-separated for this threat model,
provided the message includes explicit domain/purpose/DID binding, not
just a random value).

```
TrustLedger Authentication Request

Domain: <configured app domain, e.g. trustledger.local>
Purpose: Authenticate to TrustLedger backend
DID: did:trustledger:0xABC...
Nonce: <128-bit+ cryptographically random value>
Issued At: <ISO-8601 timestamp>
Expiration: <ISO-8601 timestamp>
```

The `Domain` field must be a fixed, server-configured value (not
client-supplied) — its purpose is exactly what EIP-712's domain
separator achieves informally: preventing a signature produced for this
application from being reusable, even coincidentally, by a different
application that happens to construct similarly-shaped signable text.

```
POST /api/auth/verify
  Request:  { "did": "...", "message": "<the exact text that was signed>", "signature": "0x..." }
  Response: { "token": "<JWT>", "expiresAt": "<ISO timestamp>" }
```

The client sends back the exact `message` text it received from
`/api/auth/challenge` and signed — not a separately-parsed `nonce` value.
Requiring the client to extract just the nonce from the message text
would be fragile (any parsing mismatch breaks verification for no good
reason); the server already has everything it needs to extract the nonce
from the returned message itself (see step 1 below).

Server-side verification, in this exact order:
1. Extract the `nonce` value from the submitted `message` text (it
   appears in the `Nonce:` line — see the canonical format above), then
   look up the stored challenge record by that nonce value. Reject (401)
   if the message doesn't contain a well-formed nonce line at all.
2. Reject (401) if not found, expired, or already `consumed: true`.
3. Reject (401) if the stored record's `did` does not exactly match the
   request's `did`. A challenge issued for one DID must not be redeemable
   by a signature claiming a different DID.
4. **Reconstruct the exact canonical message server-side** from the
   stored challenge record's fields (domain, purpose, did, nonce,
   issuedAt, expiresAt), and compare it byte-for-byte against the
   submitted `message` — reject (401) on any mismatch. This is what
   actually prevents a client from signing arbitrary text and claiming it
   was the challenge: the server never trusts the submitted message's
   content, only uses it to confirm it matches what the server itself
   would have generated.
5. Recover the signing address from `signature` over the (server-
   reconstructed, now-confirmed-matching) message (standard ECDSA
   recovery — `ethers.js` utilities).
6. Reject (401) if the recovered address does not exactly equal the
   stored record's `expectedAddress`.
7. Reject (401) if `IdentityRegistry.isActive(expectedAddress)` is false.
8. Mark the challenge record `consumed: true`.
9. Only after step 8 completes, issue the JWT. Do not issue a JWT and
   then consume the challenge — consumption must happen first, so a
   failure between the two steps cannot leave a valid, reusable challenge
   alongside an already issued token.

This chain, stated explicitly because it's the actual security property
being relied on: cryptographic signature -> recovered address ->
compared against IdentityRegistry-resolved expectedAddress -> DID
confirmed -> JWT issued. Every step depends on the previous one; skipping
the reconstruction-not-trust step (4) or the exact-address-match step (6)
reopens the exact "self-reported identity" flaw this whole authentication
design exists to close.

### JWT

- Signed with `BACKEND_SIGNING_PRIVATE_KEY` (the same key used for proof
  bundle signing — do not introduce a second key without a documented
  reason).
- Lifetime: **15 minutes**.
- Claims: `{ did, address, role, iat, exp }`.
- Establishes **authenticated identity only**. A valid JWT proves who is
  making the request. It does NOT by itself authorize any asset action —
  every protected endpoint still calls into `AccessControl` for that
  decision. See "Protected endpoint flow" below.

### MVP Security Tradeoff — JWT role snapshot

The `role` claim in a valid JWT reflects the identity's role at
authentication time. Protected endpoints do not call
`IdentityRegistry.getRole()` on every request. Consequently, a role change
is not reflected in an existing session until the JWT expires (maximum 15
minutes). **This is an accepted MVP limitation, not a defect** — it is
scoped and time-bounded by the short JWT lifetime.

**This tradeoff applies to ROLE only.** It does NOT apply to ACTIVE/REVOKED
identity status for asset-access decisions: `AccessControl.checkPermissionNow`
independently re-verifies `IdentityRegistry.isActive()` on every call (see
`CONTRACTS_SPEC.md` Section 2), so a revoked identity loses current asset
access immediately, regardless of any outstanding JWT validity. Only the
`role` claim itself can go stale within a session — not the ability to
access assets.

**Future Scope (not MVP):** per-request `getRole()` re-verification, or
JWT revocation/versioning to close the role-snapshot window entirely.

### Protected endpoint flow

```
Request → Authorization: Bearer <JWT>
  → verify JWT signature + expiry
  → reject (401) if missing, invalid, or expired
  → extract { did, address } from the verified JWT claims — NEVER from a
    client-supplied header or body field
  → proceed to the endpoint's authorization check (calls into
    AccessControl — see CONTRACTS_SPEC.md)
```

No endpoint accepts an identity claim from anywhere other than a verified
JWT. If you find yourself reading a DID from a header, query param, or body
field to decide "who is asking," that is the same flaw this section
replaced — stop and use the JWT claims instead.

## Authorization Trust Boundary — Read/Access vs. Relayed Writes

There are two distinct authorization guarantees in this system. Do not
describe them with a single global claim like "blockchain decides
authorization" — say precisely which path applies:
**blockchain-enforced authorization for asset access; backend-enforced
actor authorization for relayed privileged writes.** These are not
equivalent guarantees, and conflating them overstates what the system
actually provides.

### Read/access path — blockchain-enforced (the stronger guarantee)

```
JWT -> DID authentication
    -> AccessControl.checkPermissionNow()
    -> IdentityRegistry.isActive(subject)
    -> permission state
```

For asset access decisions (e.g. the download endpoint), the CONTRACT
evaluates the real subject DID/address relationship and current on-chain
state directly. A revoked identity is denied immediately, regardless of
JWT freshness — this is the guarantee documented in the MVP Security
Tradeoff section above.

### Privileged write path — backend-enforced, relayed on-chain (a weaker,
### distinct guarantee — read this carefully before implementing any
### privileged endpoint)

```
JWT -> authenticated DID
    -> backend verifies CURRENT on-chain role/status via IdentityRegistry
    -> backend relays the transaction
    -> contract authorizes the RELAYER, not the human actor
```

All state-changing contract calls in this backend (registering an
identity, setting a permission, registering/transferring an asset) are
submitted by the backend's own signing key — there is no per-user wallet
signing in this architecture. See `RELAYER_PRIVATE_KEY` in
Environment / connection assumptions above — this is the actual
blockchain-account key used to sign every relayed transaction, and it is
a distinct key from `BACKEND_SIGNING_PRIVATE_KEY` (which only signs JWTs
and proof bundles, and never touches the chain).

**Consequence, stated precisely:** because every relayed transaction's
`msg.sender` is the backend's own address (which is a permanently active,
permanently privileged identity — e.g. the bootstrap Admin, or another
address the team designates as the relayer), `AccessControl`'s and
`IdentityRegistry`'s own on-chain modifiers (`onlyActiveAdmin`,
`onlyActiveAdminOrManager`) always see and authorize the RELAYER, never
the actual human whose JWT initiated the request. The contract cannot
distinguish a legitimate request from a revoked identity's old,
still-relayed request, because it never sees the revoked identity's
address at all.

**Therefore: the backend's fresh `IdentityRegistry` check, performed
immediately before relaying, is the ACTUAL enforcement point for the
human actor on this path — not the contract.** This is the effective
authorization decision for relayed writes. It is not cryptographically
equivalent to per-user transaction signing, and must not be described as
such.

**MANDATORY requirement for every privileged endpoint** (identity
registration/revocation, permission grant/revoke, admin asset
operations, ownership transfers where initiated via the backend): before
relaying the transaction, the backend MUST resolve the caller's CURRENT
role and active status fresh from `IdentityRegistry` (via `getRole()` and
`isActive()`, using the `address` claim already present in the verified
JWT — not re-derived via `resolveDID()`, since the JWT's `address` claim
is itself only trustworthy because it came from a verified signature at
issuance time; `resolveDID()` is for going the other direction, DID
string to address, when only a DID is in hand) — NEVER trust the JWT's
cached `role` claim for this decision. The JWT's `role` claim is never
authoritative for privileged authorization; it exists only for coarse
routing/UI purposes, exactly as documented in the MVP Security Tradeoff
section above.

**Accepted MVP limitation — time-of-check/time-of-use race:** a narrow
race exists between the backend's authorization check and the relayed
transaction's actual inclusion in a block. Concretely:

```
T0  Backend checks Alice -> ACTIVE MANAGER  (passes)
T1  Alice is revoked (a separate admin action lands first)
T2  Backend's earlier transaction, already submitted, executes
```

At T2, the contract sees `msg.sender = BackendRelayer` — it has no way
to know Alice was the intended human actor, or that she was revoked
between T0 and T2. The transaction can succeed despite the revocation.
This window is narrow (typically one block's worth of time, not the
15-minute JWT lifetime), but it is not zero. Eliminating it entirely
requires user-controlled transaction signing (each user holding and
using their own wallet key to sign transactions directly, rather than
the backend relaying on their behalf) or an equivalent actor-binding
mechanism — this is a real architectural change, explicitly out of
scope for this MVP. Do not attempt to close this race with additional
backend-side locking or re-checking; the gap is structural to the
relayer model, not a bug to patch.

**Test coverage requirement:** the backend's privileged-write
authorization check must have test coverage symmetric to
`AccessControl`'s own "revoked identity loses access immediately" test
— specifically, a test proving the backend REJECTS a privileged write
request carrying a still-valid, unexpired JWT whose subject was revoked
after the JWT was issued. This is not satisfied by the contract-level
tests already written for `AccessControl`/`IdentityRegistry` — those
prove the CONTRACT behaves correctly when it sees the real actor's
address; they say nothing about the backend's own relay-path check,
which is a separate code path with its own failure mode.

## Endpoints

### 1. Identity

**POST /api/identities**
Registers a new identity. Calls `IdentityRegistry.registerIdentity` on-chain,
then stores the display name in Postgres (never on-chain). Requires a valid
JWT for an existing ADMIN identity (Bearer token) — registration is itself
an authorization-gated action, enforced on-chain by `registerIdentity`'s own
ADMIN-only restriction, but the backend should still reject unauthenticated
calls early with 401 rather than let every request reach the chain.

Request:
```json
{
  "identityAddress": "0xAbC123...",
  "did": "did:trustledger:0xAbC123...",
  "publicKey": "0x04a91...",
  "role": "MANAGER",
  "displayName": "Officer A"
}
```

Response (201):
```json
{
  "did": "did:trustledger:0xAbC123...",
  "role": "MANAGER",
  "status": "ACTIVE",
  "txHash": "0x9e1b..."
}
```

**GET /api/identities/:did**
Returns identity info (merges on-chain role/status with off-chain
displayName from Postgres). Not required to be authenticated for this
MVP — identity lookups are not sensitive in this scope.

### 2. Assets (Records)

**POST /api/assets**
Registers a new record. Requires `Authorization: Bearer <JWT>`. This
endpoint does the real work: hash the uploaded file, encrypt it, store the
ciphertext in Postgres, call `AssetRegistry.registerAsset` on-chain with the
hash and a metadataURI pointing back to the Postgres row.

Request: `multipart/form-data`
```
file: <the actual document>
ownerDID: "did:trustledger:0xAbC123..."
classification: "CONFIDENTIAL"
```

Processing order (must be this order, not reordered):
1. Read file bytes
2. Compute SHA-256 hash of the ORIGINAL unencrypted bytes
3. Encrypt the bytes with AES-256-GCM (generate a random IV per file)
4. Store `{encrypted_blob, iv, auth_tag, wrapped_data_key, original_filename,
   mime_type}` in the `encrypted_records` table (see Key Management below
   for how `wrapped_data_key` is produced), get back a `metadata_uri` (can
   just be the Postgres row's primary key, formatted as a URI-like string,
   e.g. `local://records/<uuid>`)
5. Call `AssetRegistry.registerAsset(assetHash, ownerDID, metadataURI, classification)`
6. Write an `audit_log` row: event_type = 'ASSET_REGISTERED'

### Key Management (two-tier, MVP scope)

Each asset's document bytes are encrypted with a unique, randomly
generated **per-asset data key** (AES-256-GCM), not a single key shared
across all documents. That per-asset key is itself encrypted ("wrapped")
under a single backend-held **master key**, and only the wrapped
ciphertext is persisted (`wrapped_data_key` in `encrypted_records` — see
DATA_MODEL.md). The master key comes from `DOCUMENT_MASTER_KEY` in the
environment — never stored in Postgres, never written on-chain. The raw,
unwrapped per-asset key exists only transiently in memory during
encrypt/decrypt (step 3 above, and the corresponding decrypt step in the
download endpoint) and is never persisted.

On download: unwrap `wrapped_data_key` using `DOCUMENT_MASTER_KEY` to
recover the per-asset key in memory, use it to decrypt `encrypted_blob`,
then discard it — do not cache or persist the unwrapped key.

This is a two-tier model (master key wraps per-asset key), not a full
KMS/HSM/Vault system — no external key-management service is introduced
for this MVP.

Response (201):
```json
{
  "assetId": 1042,
  "assetHash": "0x7f8a...",
  "metadataURI": "local://records/a1b2c3...",
  "txHash": "0x9e1b..."
}
```

**GET /api/assets/:assetId**
Returns the on-chain Asset struct (via `AssetRegistry.getAsset`) merged with
non-sensitive Postgres metadata (original_filename, mime_type — NOT the
encrypted blob itself). Not authenticated in this MVP — asset metadata
lookup is not itself sensitive; the file content is protected separately by
the download endpoint below.

**GET /api/assets/:assetId/download**
Requires `Authorization: Bearer <JWT>`. The requester's DID is taken from
the verified JWT claims — never from a client-supplied header. Before
returning the file:
1. Extract `did` from the verified JWT (see Protected endpoint flow above)
2. Call `AccessControl.checkPermissionNow(assetId, did, READ)`
3. If not allowed, return 403
4. If allowed: decrypt the blob from Postgres, return the raw file bytes,
   write an `audit_log` row (event_type = 'ASSET_ACCESSED'), and generate a
   proof bundle (see section 4) — return it in a response header
   `X-Proof-Bundle` (base64-encoded JSON) alongside the file body

### 3. Permissions

**POST /api/permissions**
Sets a permission. Requires `Authorization: Bearer <JWT>` for an ADMIN or
MANAGER identity — enforced on-chain by `setPermission`'s own access rule,
but reject unauthenticated calls early with 401. Calls
`AccessControl.setPermission` on-chain.

Request:
```json
{
  "assetId": 1042,
  "subjectDID": "did:trustledger:0xDef456...",
  "action": "READ",
  "state": "GRANTED"
}
```

Response (201):
```json
{
  "permissionId": 87,
  "validFrom": 1735660800,
  "txHash": "0x9e1b..."
}
```

**GET /api/permissions/verify**
THE ENDPOINT FOR OUR CORE USP. Given an asset, subject, action, and a
timestamp, calls `AccessControl.checkPermissionAtTime` and returns whether
that access would have been legitimate at that historical moment. Not
authenticated in this MVP — this is explicitly meant to be a public
verifiability feature (an auditor or outside party checking a historical
claim), not a protected action.

Query params: `?assetId=1042&subjectDID=did:trustledger:0xDef456...&action=READ&atTimestamp=1735664520`

Response (200):
```json
{
  "assetId": 1042,
  "subjectDID": "did:trustledger:0xDef456...",
  "action": "READ",
  "atTimestamp": 1735664520,
  "wasLegitimate": true,
  "permissionVersionUsed": {
    "permissionId": 87,
    "state": "GRANTED",
    "validFrom": 1735660800,
    "validUntil": 0
  }
}
```

### 4. Proof Bundles

**POST /api/proof-bundles/verify**
Accepts a proof bundle (the JSON structure defined in DATA_MODEL.md section
4) and independently verifies it: checks the signature, then re-queries the
chain to confirm the claimed permission/tx data is real. This endpoint MUST
work even for bundles generated by a different deployment — it should not
assume the bundle came from this exact running instance, only that it can
reach the same chain (or a chain with the same contract state, for local
dev). Not authenticated — verification is meant to be usable by anyone
holding a bundle, including someone with no account in this system at all.

This is **Level 2 — independent online verification** (see DATA_MODEL.md
section 4): it does not require this backend's session/JWT state, and it
re-derives its answer from chain state rather than trusting this instance's
say-so. It is NOT offline — it still requires network access to an RPC
endpoint reaching the chain. Do not describe this endpoint, or the proof
bundle mechanism generally, as "offline verification" in documentation or
pitch material. True offline verification (Level 3 — local inclusion proof,
no network at all) is explicitly Future Scope, not built here.

Request: the proof bundle JSON (see DATA_MODEL.md section 4)

Response (200):
```json
{ "valid": true, "reason": null }
```
or
```json
{ "valid": false, "reason": "signature mismatch" }
```

Bundle generation (used internally by the download endpoint, not a public
route) should live in `src/services/proofBundle.ts` — sign the canonical
JSON (sorted keys, no whitespace) using `BACKEND_SIGNING_PRIVATE_KEY` with
standard ECDSA (reuse `ethers.js` utilities for this rather than a separate
crypto library).

**Note on what this signature does and does not prove:** the signature over
a proof bundle attests that the *backend* asserts these facts — it is not a
"signature chain back to the smart contract" (smart contracts do not sign
transactions). See DATA_MODEL.md section 4 for the precise distinction
between what's independently verifiable on-chain versus what's currently
only backend-attested.

## Error handling convention

All error responses follow this shape:
```json
{ "error": "human-readable message", "code": "MACHINE_READABLE_CODE" }
```
Use standard HTTP status codes (400 bad request, 401 unauthorized, 403
forbidden, 404 not found, 500 server error). Do not invent a custom status
scheme.

## What NOT to build in this phase

- No rate limiting, no caching layer — correctness and demo-readiness first
- No file size limits beyond what's reasonable for a demo (a few MB is fine)
- No JWT revocation/versioning system (see MVP Security Tradeoff above —
  documented limitation, not built now)
- No per-request `IdentityRegistry.getRole()` re-verification (see above)
