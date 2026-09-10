# Backend API Specification

Read `DATA_MODEL.md` first. This backend is the layer between the frontend
(built later), the smart contracts (see `CONTRACTS_SPEC.md`), and Postgres.
It does NOT contain business logic that belongs on-chain — permission
enforcement, role checks, and ownership rules live in the contracts. The
backend's job: hash/encrypt files, call contracts, store/retrieve off-chain
data, and generate/verify proof bundles.

## Stack (locked)

- Node.js + TypeScript
- Express (or Fastify if you strongly prefer — confirm with the team first)
- `ethers.js` (v6) to talk to the deployed contracts
- `pg` or Prisma for PostgreSQL access — Prisma is recommended for speed of
  development, but either is acceptable
- Standard Node `crypto` module for AES-256-GCM and SHA-256 — do not add a
  third-party crypto library, the built-in module covers everything needed

## Environment / connection assumptions

The backend connects to a **local Hardhat network** (see CONTRACTS_SPEC.md —
this is not a testnet in this phase). Expect a `.env` with:

```
HARDHAT_RPC_URL=http://127.0.0.1:8545
IDENTITY_REGISTRY_ADDRESS=<filled in after contracts are deployed locally>
ACCESS_CONTROL_ADDRESS=<filled in after contracts are deployed locally>
ASSET_REGISTRY_ADDRESS=<filled in after contracts are deployed locally>
BACKEND_SIGNING_PRIVATE_KEY=<for signing proof bundles, NOT a blockchain key>
DATABASE_URL=<postgres connection string>
```

The contract addresses won't exist until the contracts teammate has deployed
locally and shared them — until then, build against a mocked/stubbed
contract-interaction layer so you're not blocked. Structure your code so the
real contract calls are isolated in one module (e.g. `src/services/chain.ts`)
that's easy to swap from mock to real.

## Endpoints

### 1. Identity

**POST /api/identities**
Registers a new identity. Calls `IdentityRegistry.registerIdentity` on-chain,
then stores the display name in Postgres (never on-chain).

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
displayName from Postgres).

### 2. Assets (Records)

**POST /api/assets**
Registers a new record. This endpoint does the real work: hash the uploaded
file, encrypt it, store the ciphertext in Postgres, call
`AssetRegistry.registerAsset` on-chain with the hash and a metadataURI
pointing back to the Postgres row.

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
4. Store `{encrypted_blob, iv, auth_tag, original_filename, mime_type}` in
   the `encrypted_records` table, get back a `metadata_uri` (can just be the
   Postgres row's primary key, formatted as a URI-like string, e.g.
   `local://records/<uuid>`)
5. Call `AssetRegistry.registerAsset(assetHash, ownerDID, metadataURI, classification)`
6. Write an `audit_log` row: event_type = 'ASSET_REGISTERED'

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
encrypted blob itself).

**GET /api/assets/:assetId/download**
Requires an `X-Requester-DID` header. Before returning the file:
1. Call `AccessControl.checkPermissionNow(assetId, requesterDID, READ)`
2. If not allowed, return 403
3. If allowed: decrypt the blob from Postgres, return the raw file bytes,
   write an `audit_log` row (event_type = 'ASSET_ACCESSED'), and generate a
   proof bundle (see section 4) — return it in a response header
   `X-Proof-Bundle` (base64-encoded JSON) alongside the file body

### 3. Permissions

**POST /api/permissions**
Sets a permission. Calls `AccessControl.setPermission` on-chain.

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
that access would have been legitimate at that historical moment.

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
dev). This is what "offline verification" means in the pitch — build this
endpoint to be genuinely self-contained, not dependent on session state.

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

## Error handling convention

All error responses follow this shape:
```json
{ "error": "human-readable message", "code": "MACHINE_READABLE_CODE" }
```
Use standard HTTP status codes (400 bad request, 403 forbidden, 404 not
found, 500 server error). Do not invent a custom status scheme.

## What NOT to build in this phase

- No user authentication/session system beyond the DID + on-chain role check
  described above — that's the actual auth model for this hackathon scope
- No rate limiting, no caching layer — correctness and demo-readiness first
- No file size limits beyond what's reasonable for a demo (a few MB is fine)
