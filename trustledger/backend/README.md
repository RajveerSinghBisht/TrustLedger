<p align="center">
  <img src="../frontend/public/pramaan-icon.png" width="100" alt="PRAMAAN Emblem" />
</p>

# ⚙️ PRAMAAN — Backend API Engine

The PRAMAAN Backend is a high-performance, strictly typed Node.js/TypeScript API layer built with Express 5, Prisma ORM, and Ethers.js v6.

It bridges off-chain secure document storage with the on-chain smart contract ecosystem, orchestrating **EIP-712 challenge-response wallet authentication**, **AES-256-GCM document encryption**, and **cryptographic proof bundle emission**.

---

## ⚡ Server Configuration

- **Port**: Strictly configured to run on **`http://localhost:3000`**.
- **Database**: PostgreSQL 16 (hosted via Docker on port `5432`).
- **Blockchain Gateway**: Connected via JSON-RPC to `http://127.0.0.1:8545`.

---

## 🐳 Database Setup (Docker & Prisma)

PRAMAAN requires a running PostgreSQL instance for identity metadata and encrypted document storage.

### 1. Launch PostgreSQL with Docker Compose
From this directory (`trustledger/backend`):
```bash
# Start PostgreSQL container in detached mode
docker compose up -d

# Verify container status
docker ps
```

*The default PostgreSQL configuration:*
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

## 🚀 Running the Backend

### Development Mode (with hot-reload):
```bash
npm run dev
```

### Production Build & Run:
```bash
npm run build
npm start
```
*Listens at `http://localhost:3000`. You will see `TrustLedger backend listening on port 3000` upon initialization.*

---

## 🔐 Core Security & Cryptographic Pipelines

### 1. EIP-712 Wallet Authentication
Users never transmit plaintext passwords. Authentication uses structured, domain-bound cryptographic challenges:
```
1. Client requests nonce:          POST /api/auth/challenge
2. Backend generates nonce:        Stores in PostgreSQL with 5-minute expiration
3. Client signs with MetaMask:     Personal signature on EIP-712 Typed Data
4. Backend verifies on-chain:      Validates signer address & IdentityRegistry DID
5. Ephemeral JWT issued:           Contains DID and Role claims (1-hour expiry)
```

### 2. AES-256-GCM Document Vault
- When an asset is registered (`POST /api/assets`), the backend calculates its **SHA-256 digest** and encrypts the payload with **AES-256-GCM** using an ephemeral 96-bit initialization vector (IV) and authentication tag.
- The document digest is anchored on-chain in `AssetRegistry.sol`.
- Decryption is performed in memory strictly after `AccessControl.sol` confirms active policy authorization.

### 3. Cryptographic Proof Bundle Emission
When an authorized subject downloads a document (`GET /api/assets/:id/download`), the backend validates on-chain access, emits an on-chain `AssetAccessed` event, and generates a portable proof bundle:
```json
{
  "assetId": "0x...",
  "contentHash": "0x...",
  "subjectDid": "did:trustledger:0x...",
  "policyVersion": 3,
  "accessedAt": 1727048123,
  "blockchainTxHash": "0x...",
  "signerSignature": "0x..."
}
```
*This bundle is returned in the `X-Proof-Bundle` response header and can be verified offline by any third-party auditor.*

---

## 📡 REST API Reference

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/challenge` | Public | Generates an EIP-712 nonce challenge for a wallet address. |
| `POST` | `/api/auth/verify` | Public | Verifies the EIP-712 signature and returns a JWT bearer token. |
| `GET` | `/api/identities` | JWT | Lists all registered DIDs and their roles. |
| `POST` | `/api/identities` | Admin | Registers a new DID in PostgreSQL and `IdentityRegistry.sol`. |
| `POST` | `/api/assets` | Manager | Encrypts document (AES-256-GCM) and anchors hash in `AssetRegistry.sol`. |
| `GET` | `/api/assets/:id/download` | Authorized | Verifies on-chain policy, logs access, streams decrypted file & proof bundle. |
| `POST` | `/api/permissions/grant` | Manager/Admin | Grants access to a DID with temporal bounds in `AccessControl.sol`. |
| `POST` | `/api/permissions/revoke` | Manager/Admin | Revokes access on-chain. Zero-overwrite versioning. |
| `POST` | `/api/verify/bundle` | Public | Verifies proof bundle integrity against blockchain Merkle root. |
