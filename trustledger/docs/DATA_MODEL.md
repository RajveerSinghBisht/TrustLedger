# Data Model

This document defines every data shape shared between contracts and backend.
Both `CONTRACTS_SPEC.md` and `BACKEND_SPEC.md` reference this file. If you
change a field here, you must update both specs and notify the team — this
is the single source of truth for shapes crossing the on-chain/off-chain
boundary.

## 1. Identity

Represents a user's Decentralized Identifier.

| Field           | Type    | Where it lives | Notes                                  |
|-----------------|---------|-----------------|-----------------------------------------|
| did             | string  | On-chain + DB   | Format: `did:trustledger:<address>`     |
| publicKey       | bytes   | On-chain        | Used for challenge-response auth        |
| role            | enum    | On-chain        | ADMIN \| MANAGER \| AUDITOR \| USER     |
| displayName     | string  | DB only         | Never on-chain (privacy)                |
| status          | enum    | On-chain        | ACTIVE \| REVOKED (current status only — see note below) |
| createdAt       | uint256 | On-chain        | Unix timestamp                          |

Role is an on-chain enum (see CONTRACTS_SPEC.md). `displayName` and any other
human-readable PII stay in Postgres only — never written to the chain.

**Note on status history:** `IdentityRegistry` stores only the CURRENT
status. It does not retain a history of when status changed. This is
sufficient for real-time access decisions but has a direct consequence for
historical permission verification — see CONTRACTS_SPEC.md Section 2 for
the specific open question this creates around `checkPermissionAtTime`.

## 2. Asset (Record)

Represents one registered document (compliance certificate, maintenance
record, spares authorization, etc.).

| Field           | Type    | Where it lives | Notes                                    |
|-----------------|---------|-----------------|-------------------------------------------|
| assetId         | uint256 | On-chain        | Auto-incremented, also the NFT token ID   |
| assetHash       | bytes32 | On-chain        | SHA-256 of the original (unencrypted) file|
| ownerDID        | string  | On-chain        | Derived from the ERC-721 token owner's registered address — see CONTRACTS_SPEC.md Section 3 on ownership consistency |
| metadataURI     | string  | On-chain        | Pointer to off-chain encrypted blob       |
| classification  | enum    | On-chain        | PUBLIC \| INTERNAL \| CONFIDENTIAL        |
| status          | enum    | On-chain        | ACTIVE \| REVOKED                         |
| version         | uint256 | On-chain        | Increments on re-registration of same doc |
| createdAt       | uint256 | On-chain        | Unix timestamp                            |

`metadataURI` points to a row in the `encrypted_records` table in Postgres
(see below) — the actual encrypted file bytes and IV live off-chain, never
on-chain. Only the hash and pointer go on-chain.

**Ownership note:** because this asset is also an ERC-721 token, its real
ownership is tracked by the ERC-721 owner address. `ownerDID` must always be
kept in sync with that address (resolved via IdentityRegistry's address↔DID
mapping) — it is not an independently-settable field. See
CONTRACTS_SPEC.md Section 3 for the exact requirement on `transferAsset()`.

## 3. Permission (Versioned — this is what makes policy-at-the-time work)

This is the core structure behind our primary USP. Permissions are NEVER
overwritten. Every change creates a new version. Nothing is deleted.

| Field           | Type    | Where it lives | Notes                                    |
|-----------------|---------|-----------------|-------------------------------------------|
| permissionId    | uint256 | On-chain        | Auto-incremented                          |
| assetId         | uint256 | On-chain        | Which asset this permission applies to    |
| subjectDID      | string  | On-chain        | Who is granted/revoked                    |
| action          | enum    | On-chain        | READ \| WRITE \| TRANSFER                 |
| state           | enum    | On-chain        | GRANTED \| REVOKED                        |
| grantedBy       | string  | On-chain        | DID of the Admin/Manager who made the change |
| validFrom       | uint256 | On-chain        | Unix timestamp — when this version became active |
| validUntil      | uint256 | On-chain        | Unix timestamp of NEXT version, or 0 if still current |

**How policy-at-the-time verification actually works, concretely:** to check
whether `subjectDID` could perform `action` on `assetId` at timestamp `T`,
find the permission record where `validFrom <= T < validUntil` (or
`validUntil == 0` and `validFrom <= T` for the current version). That record's
`state` is the answer. This requires querying by asset + subject + timestamp
range, not just "give me the current row" — see CONTRACTS_SPEC.md for the
exact function signature that does this.

**Two distinct authorization modes — do not conflate them:**
- `checkPermissionNow` — permission state AND current `IdentityRegistry`
  status (`isActive()`) are both required. A revoked identity is denied
  immediately.
- `checkPermissionAtTime` — permission state as of the historical
  timestamp only; current identity status is NOT applied retroactively.
  See CONTRACTS_SPEC.md Section 2 for the exact rule and the open question
  around historical identity status (IdentityRegistry has no status
  history).

## 4. Proof Bundle (Our second USP — generated, not stored on-chain)

A proof bundle is generated on demand when someone accesses or verifies a
record. It is NOT stored on-chain or in the database as a table — it's
constructed at request time from on-chain data and signed, then handed to
the requester. They keep it; we don't need to.

```json
{
  "assetId": 1042,
  "assetHash": "0x7f8a...",
  "accessedBy": "did:trustledger:0xAbC123...",
  "accessTimestamp": 1735689600,
  "permissionVersionUsed": {
    "permissionId": 87,
    "state": "GRANTED",
    "validFrom": 1735660800,
    "validUntil": 0
  },
  "onChainTxRef": "0x9e1b...",
  "signature": "0x..."
}
```

`signature` is generated by the backend's signing key over the canonical
JSON of every other field.

### What this bundle does and does not independently prove

Two distinct claims are bundled together here, and they have different
strength. Keep this distinction explicit in any documentation or pitch
material derived from this section:

- **Authorization Proof** — "this identity was authorized to perform this
  action on this asset at this time." This claim IS independently
  verifiable: a third party can re-query `checkPermissionAtTime` (or
  `checkPermissionNow`) against the public chain state and confirm it
  themselves, without trusting this backend.
- **Access Attestation** — "this access actually occurred." As of this
  spec revision, this is made independently verifiable via the
  `AssetAccessed` on-chain event (see CONTRACTS_SPEC.md Section 2) emitted
  when the backend grants a download. Before this event existed, this
  claim was only backend-asserted (recorded solely in Postgres's
  `audit_log`), which is a materially weaker guarantee than the
  Authorization Proof half — do not describe the two as equally strong.

**Terminology corrections (apply throughout, including diagrams and pitch
material derived from this document):**
- Do NOT call this "offline verification." Verifying a bundle requires an
  independent RPC connection to a blockchain node — it does not need this
  backend specifically, but it is not offline. Use **"independent
  verification"** or **"platform-independent verification"** (Level 2 of
  three; see below).
- Do NOT describe the signature as a "signature chain back to the smart
  contract." Smart contracts do not sign transactions. The signature is
  the *backend's own signing key* (`BACKEND_SIGNING_PRIVATE_KEY`) attesting
  to the bundle's contents — a distinct fact from anything the chain
  itself signs.
- Do NOT claim "no trust in our servers at all." The Access Attestation
  half of the bundle now has on-chain backing via `AssetAccessed`, but the
  bundle's `signature` field is still a backend attestation, not a
  blockchain-native fact — be precise about which parts of the bundle are
  independently checkable against chain state versus which parts rely on
  trusting this backend's signing key.

### Three levels of verification

- **Level 1 — Platform verification.** TrustLedger UI → TrustLedger
  backend → blockchain. Least independent; relies on this specific running
  instance.
- **Level 2 — Independent online verification.** Proof bundle → a
  standalone verifier (could be a different deployment, a CLI tool,
  anyone) → an independent RPC endpoint → blockchain. Does not require
  this backend. Does require network access to some blockchain node. **This
  is what the current MVP actually builds — see BACKEND_SPEC.md section 4,
  `POST /api/proof-bundles/verify`.**
- **Level 3 — True offline verification.** Proof bundle → a locally held
  blockchain checkpoint/inclusion proof → local cryptographic verification,
  no network access at all. **Explicitly Future Scope — not built in this
  phase.**

See BACKEND_SPEC.md section 4 for the exact generation and verification
endpoints.

## 5. PostgreSQL Schema (off-chain metadata only)

```sql
CREATE TABLE users (
    did             VARCHAR(255) PRIMARY KEY,
    display_name    VARCHAR(255) NOT NULL,
    email           VARCHAR(255),
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE encrypted_records (
    metadata_uri     VARCHAR(255) PRIMARY KEY,   -- matches on-chain metadataURI
    asset_id         BIGINT NOT NULL,             -- matches on-chain assetId
    encrypted_blob   BYTEA NOT NULL,              -- document bytes, AES-256-GCM,
                                                   -- encrypted with the PER-ASSET key
    iv               BYTEA NOT NULL,              -- initialization vector for encrypted_blob
    auth_tag         BYTEA NOT NULL,              -- GCM auth tag for encrypted_blob
    wrapped_data_key BYTEA NOT NULL,              -- the per-asset data key, wrapped
                                                   -- (encrypted) under the master key —
                                                   -- see Key Management below; this is
                                                   -- the wrapped ciphertext itself, not
                                                   -- a reference to it
    original_filename VARCHAR(255),
    mime_type        VARCHAR(100),
    created_at       TIMESTAMP DEFAULT NOW()
);

CREATE TABLE audit_log (
    id              SERIAL PRIMARY KEY,
    event_type      VARCHAR(50) NOT NULL,   -- e.g. 'IDENTITY_CREATED', 'ASSET_ACCESSED'
    actor_did       VARCHAR(255) NOT NULL,
    asset_id        BIGINT,
    tx_hash         VARCHAR(66),             -- on-chain transaction hash
    details         JSONB,
    created_at      TIMESTAMP DEFAULT NOW()
);
```

This is intentionally minimal. Postgres holds only what must never go on-chain
(encrypted file bytes, PII) plus a convenience audit log for fast querying —
the on-chain events remain the source of truth for anything disputed,
including `ASSET_ACCESSED` rows, which should be treated as a queryable
mirror of the `AssetAccessed` on-chain event (CONTRACTS_SPEC.md Section 2),
not as the authoritative record of that access.

## Key Management (two-tier, MVP scope)

```
                    MASTER KEY
                        │
                 wraps / unwraps
                        │
                        ▼
              PER-ASSET DATA KEY
                        │
                 AES-256-GCM
                        │
                        ▼
                  DOCUMENT BYTES
```

- Each uploaded asset gets a unique, randomly generated per-asset data key.
- Document bytes are encrypted with that per-asset key (AES-256-GCM) — this
  produces `encrypted_blob`, `iv`, `auth_tag` above.
- The per-asset key itself is then wrapped (encrypted) under a single
  backend-held master key, and the resulting `wrapped_data_key` ciphertext
  is what's stored — not the raw per-asset key.
- The master key is supplied via environment variable/secret. It is never
  stored in PostgreSQL and never written to the blockchain. See
  BACKEND_SPEC.md for the exact env var.
- The raw (unwrapped) per-asset key exists only transiently in memory
  during encrypt/decrypt — it is never persisted anywhere.
- The blockchain continues to store only the asset hash, provenance, and
  authorization data (Sections 2–3 above) — no key material of any kind
  goes on-chain.
- This is explicitly NOT a full KMS/HSM/Vault architecture. No external
  key-management service is introduced for the MVP.

**Not included in this schema:** a nonce table for the authentication flow
(see BACKEND_SPEC.md Authentication section) — implementers should add a
table or equivalent store for `{ nonce, did, expiresAt, consumed }` records;
exact table name/shape is an implementation detail not fixed here.

## Field-naming convention

- On-chain and API fields: `camelCase` (matches Solidity and JS/TS convention)
- Database columns: `snake_case` (matches SQL convention)
- Never rename a field defined here without updating this document first
