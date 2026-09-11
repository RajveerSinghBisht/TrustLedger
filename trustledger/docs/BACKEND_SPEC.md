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
BACKEND_SIGNING_PRIVATE_KEY=<used for BOTH JWT signing and proof-bundle
                              signing — NOT a blockchain account key>
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
  Response: { "nonce": "...", "expiresAt": "<ISO timestamp>" }
```

The server stores a nonce record:
```
{ nonce, did, expiresAt, consumed: false }
```
The nonce is bound to the requesting DID at issuance — this binding is
checked in the verify step below, not assumed.

```
POST /api/auth/verify
  Request:  { "did": "...", "nonce": "...", "signature": "0x..." }
  Response: { "token": "<JWT>", "expiresAt": "<ISO timestamp>" }
```

Server-side verification, in this exact order:
1. Look up the stored nonce record by nonce value.
2. Reject (401) if not found, expired, or already `consumed: true`.
3. Reject (401) if the stored record's `did` does not exactly match the
   request's `did`. A nonce issued for one DID must not be redeemable by a
   signature claiming a different DID.
4. Verify `signature` against the DID's registered public key, fetched via
   `IdentityRegistry.getIdentity(identityAddress)`.
5. Reject (401) if `IdentityRegistry.isActive(identityAddress)` is false.
6. Mark the nonce record `consumed: true`.
7. Only after step 6 completes, issue the JWT. Do not issue a JWT and then
   consume the nonce — consumption must happen first, so a failure between
   the two steps cannot leave a valid, reusable nonce alongside an already
   issued token.

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
