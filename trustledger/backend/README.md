<p align="center">
  <img src="../frontend/public/pramaan-icon.png" width="100" alt="PRAMAAN Emblem" />
</p>

# ⚙️ PRAMAAN — Backend API Engine

The PRAMAAN Backend is a high-performance, strictly typed Node.js/TypeScript API layer built with Express 5, Prisma ORM, and Ethers.js v6.

It bridges off-chain secure document storage with the on-chain smart contract ecosystem, orchestrating **EIP-712 challenge-response wallet authentication**, **AES-256-GCM envelope document encryption**, **dual-custody consensus routing**, and **cryptographic proof bundle emission**.

---

## ⚡ Server Configuration

- **Port**: Configured to run on **`http://localhost:3000`**.
- **Database**: PostgreSQL 16 (hosted via Docker on port `5432`).
- **Blockchain Gateway**: Connected via JSON-RPC to `http://127.0.0.1:8545`.

---

## 🐳 Database Setup (Docker & Prisma)

PRAMAAN uses PostgreSQL for off-chain application metadata, user profiles, encrypted document payloads, wrapped per-asset encryption keys, and authentication challenge nonces.

### 1. Launch PostgreSQL with Docker Compose
From this directory (`trustledger/backend`):
```bash
# Start PostgreSQL container in detached mode
docker compose up -d

# Verify container status
docker ps
```

*Default PostgreSQL configuration:*
- **Host**: `localhost:5432`
- **Database**: `trustledger`
- **User**: `postgres`
- **Password**: `postgres`

### 2. Generate Prisma Client & Run Migrations
```bash
# Install dependencies
npm install

# Generate typed Prisma client
npx prisma generate

# Apply migrations to PostgreSQL
npx prisma migrate dev --name init
```

---

## 🚀 Running & Testing

### Development Mode:
```bash
npm run dev
```

### Production Build & Run:
```bash
npm run build
npm start
```
*Listens at `http://localhost:3000`.*

### Run Automated Test Suite:
```bash
npm test
```
*Executes **75 passing tests across 7 test suites** covering auth nonces, EIP-712 verification, AES-GCM envelope encryption/decryption, dual-custody approval lifecycle, access gating, rate-limiting, and independent proof bundle verification.*

---

## 🔐 Core Security & Cryptographic Pipelines

### 1. EIP-712 Wallet Authentication
Users never transmit plaintext passwords. Authentication uses structured, domain-bound cryptographic challenges:
```
1. Client requests nonce:          POST /api/auth/challenge
2. Backend generates nonce:        Stores challenge in PostgreSQL with 5-minute expiry
3. Client signs with Wallet:       Personal signature on EIP-712 Typed Data
4. Backend verifies on-chain:      Validates signer address & IdentityRegistry DID/Status
5. Ephemeral JWT issued:           Contains DID and Role claims (1-hour expiry)
```

### 2. Two-Tier Envelope Encryption (AES-256-GCM)
- When an asset is registered (`POST /api/assets`), the backend generates a unique per-asset data key (DEK) and calculates the **SHA-256 digest** of the raw file.
- The file is encrypted using **AES-256-GCM** with a 96-bit initialization vector (IV) and 128-bit authentication tag.
- The per-asset key is wrapped with the server master key (KEK).
- The raw file hash and metadata URI are anchored on-chain in `AssetRegistry.sol`.
- Decryption is performed in memory strictly after `AccessControl.sol` confirms active policy authorization via `checkPermissionNow()`.

### 3. Cryptographic Proof Bundle Emission
When an authorized subject downloads a document (`GET /api/assets/:id/download`), the backend validates on-chain access, triggers an on-chain `AssetAccessed` event via `AccessControl.recordAccess()`, and generates a deterministic proof bundle:
```json
{
  "assetId": 1042,
  "assetHash": "0x5f4dcc3b5aa765d61d8327deb882cf99...",
  "accessedBy": "did:trustledger:0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  "accessTimestamp": 1727048123,
  "permissionVersionUsed": {
    "permissionId": 3,
    "state": "GRANTED",
    "validFrom": 1726000000,
    "validUntil": 0
  },
  "onChainTxRef": "0x8a92f8190c1e8d9...",
  "signature": "0x7b58e94a8120c43..."
}
```
*This bundle is returned in the `X-Proof-Bundle` response header and can be verified independently by any third party holding the JSON via the public verification endpoint or directly against an EVM RPC node without trusting the PRAMAAN backend.*

---

## 📡 REST API Reference

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/challenge` | Public | Generates an EIP-712 nonce challenge for a wallet address. |
| `POST` | `/api/auth/verify` | Public | Verifies EIP-712 signature against `IdentityRegistry` and returns JWT token. |
| `GET` | `/api/identities` | JWT | Lists registered DIDs and on-chain roles. |
| `POST` | `/api/identities` | Admin | Registers a new DID in PostgreSQL and on-chain in `IdentityRegistry.sol`. |
| `GET` | `/api/identities/:did` | JWT | Queries on-chain identity details and status for a specific DID. |
| `POST` | `/api/assets` | Admin/Manager | Encrypts document (AES-256-GCM), records metadata, and anchors hash in `AssetRegistry.sol`. |
| `GET` | `/api/assets/:assetId` | JWT | Fetches asset metadata, classification level, and token details. |
| `GET` | `/api/assets/:assetId/download` | Authorized | Validates permission on-chain, records `AssetAccessed`, streams decrypted bytes & proof bundle. |
| `POST` | `/api/permissions` | Admin/Manager | Direct single-sig grant/revocation for PUBLIC and INTERNAL assets. |
| `POST` | `/api/permissions/request` | Admin/Manager | Initiates permission change. Routes CONFIDENTIAL assets to dual-custody (24h TTL). |
| `GET` | `/api/permissions/requests` | JWT | Queries active/pending dual-custody authorization requests. |
| `GET` | `/api/permissions/requests/:requestId` | JWT | Inspects specific pending dual-custody request and TTL status. |
| `POST` | `/api/permissions/requests/:requestId/approve` | Officer 2 | Approves pending dual-custody request (enforces non-self-approval on-chain). |
| `POST` | `/api/permissions/requests/:requestId/cancel` | Maker/Admin | Cancels a pending dual-custody request before execution. |
| `GET` | `/api/permissions/verify` | Public | Historical policy-at-the-time verifier (`checkPermissionAtTime`). |
| `POST` | `/api/proof-bundles/verify` | Public | Independent online verification of proof bundle signature and on-chain state. |
