<p align="center">
  <img src="trustledger/frontend/public/pramaan-icon.png" width="140" alt="PRAMAAN Emblem" />
  <br />
  <img src="trustledger/frontend/public/pramaan-wordmark.png" width="420" alt="PRAMAAN Wordmark" />
</p>

<p align="center">
  <strong>Enterprise Zero-Trust Blockchain Access Control, Dynamic RBAC & Cryptographic Temporal Audits</strong>
</p>

<p align="center">
  <em>Developed for Smart India Hackathon (SIH 2026) // Problem Statement 26125</em><br />
  <strong>Organization:</strong> Bharat Electronics Limited (BEL) &bull; Ministry of Defence, Government of India
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Blockchain-Ethereum%20%2F%20EVM-3C3C3D?style=for-the-badge&logo=ethereum" alt="EVM" />
  <img src="https://img.shields.io/badge/Solidity-0.8.24-363636?style=for-the-badge&logo=solidity" alt="Solidity" />
  <img src="https://img.shields.io/badge/Next.js-16.3.5%20(Turbopack)-black?style=for-the-badge&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/TypeScript-5.5-3178C6?style=for-the-badge&logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Node.js-20.x%2B-339933?style=for-the-badge&logo=node.js" alt="Node.js" />
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?style=for-the-badge&logo=postgresql" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Security-AES--256--GCM-10B981?style=for-the-badge" alt="AES-256-GCM" />
</p>

---

## 📑 Table of Contents

- [Executive Summary](#-executive-summary)
- [Problem Statement Context (BEL)](#-problem-statement-context-bel)
- [Core Architectural Innovations](#-core-architectural-innovations)
- [System Architecture & Flow](#-system-architecture--flow)
- [Quick Start: Choose Your Launch Option](#-quick-start-choose-your-launch-option)
  - [Prerequisites](#1-prerequisites)
  - [Database Setup (Docker & Prisma)](#2-database-setup-docker--prisma)
  - [Option A: 1-Command Unified Startup (Recommended)](#option-a-1-command-unified-startup-recommended)
  - [Option B: Manual 4-Terminal Startup](#option-b-manual-4-terminal-startup)
- [Smart Contracts Architecture](#-smart-contracts-architecture)
- [Cryptographic Security Model](#-cryptographic-security-model)
- [Repository Directory Structure](#-repository-directory-structure)
- [Troubleshooting & FAQ](#-troubleshooting--faq)
- [License & SIH Disclaimer](#-license--sih-disclaimer)

---

## 🏛 Executive Summary

**PRAMAAN** (प्रमाण — *"Proof / Testimony"*) is an immutable, zero-trust digital asset access control and temporal audit platform. Built specifically for high-integrity defence, aerospace, and mission-critical enterprise environments, PRAMAAN eliminates single points of failure in document verification.

Every identity is an on-chain Decentralized Identifier (**DID**). Every sensitive technical manual, maintenance report, or spares authorization order is encrypted off-chain using **AES-256-GCM**, with its cryptographic fingerprint anchored immutably to an EVM blockchain. Access permissions are verified on-chain at block speed, producing verifiable, portable cryptographic proof bundles that any third party (military depot, auditor, or judicial court) can verify completely offline.

---

## 🎯 Problem Statement Context (BEL)

In long-lifecycle defence systems (such as radar arrays, avionics, and naval communication systems manufactured by **Bharat Electronics Limited**) operating across 20–30 year service spans:

1. **The Legacy Vulnerability**: Traditional Role-Based Access Control (RBAC) relies on mutable centralized relational databases. A rogue database administrator or compromised service account can alter access records or forge authorizations retrospectively without leaving a tamper-evident trace.
2. **The Temporal Audit Problem**: Traditional systems only know *current* permissions. If an engineer legitimately accessed classified documentation in 2024, but had their clearance revoked in 2026, standard RBAC answers: *"Access denied."* It cannot mathematically prove whether the 2024 access was lawful under the exact rules active at that precise timestamp.
3. **Air-Gapped & Third-Party Verification**: Military field depots, independent maintenance contractors, and judicial bodies often operate with air-gapped networks. They need a way to verify access legitimacy without connecting to or trusting the vendor's live database.

**PRAMAAN solves all three challenges.**

---

## ⚡ Core Architectural Innovations

### 1. Policy-at-the-Time Temporal Verification
Permissions in PRAMAAN are stored as an append-only, versioned timeline on-chain (`AccessControl.sol`), never a mutable single-row state. When an audit query is performed for any timestamp $T$:
$$\text{Permission}(T) = \text{Policy}_{\text{version}} \quad \text{where} \quad \text{validFrom} \le T \le \text{validUntil} \land \neg\text{revoked}$$
The system mathematically proves whether access was legitimate under the rules that existed at the exact second it occurred.

### 2. Standalone Cryptographic Proof Bundles (`X-Proof-Bundle`)
Every authorized asset download emits a self-contained cryptographic proof package:
- Target Asset Content SHA-256 Fingerprint
- Requester DID & Public Key
- Active Policy Version on-chain at time of access
- Cryptographic signature from the PRAMAAN Protocol Authority
- EVM Block Header & Merkle Inclusion Receipt

*Any auditor holding this bundle can verify its authenticity completely offline via the `/verify` portal without connecting to the PRAMAAN backend.*

### 3. Separation of Concerns (On-Chain Truth vs. Off-Chain Confidentiality)
- **On-Chain**: Identity registration, role assignments, immutable policy bounds, access log hashes, and temporal timestamps.
- **Off-Chain**: Heavy document files, encrypted via AES-256-GCM with Ephemeral Key Derivation. No classified document payload ever touches the public blockchain.

---

## 🔄 System Architecture & Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as Subject (Engineer/User)
    participant UI as PRAMAAN dApp (:3001)
    participant API as Backend Engine (:3000)
    participant DB as PostgreSQL (:5432)
    participant EVM as Hardhat Blockchain (:8545)

    Note over User,EVM: 1. EIP-712 Challenge-Response Authentication
    User->>UI: Connect Web3 Wallet
    UI->>API: Request Nonce Challenge
    API-->>UI: Nonce + Structured EIP-712 Data
    User->>UI: Sign Challenge with Private Key
    UI->>API: POST /api/auth/verify (Signature + DID)
    API->>EVM: Validate DID in IdentityRegistry.sol
    API-->>UI: Issue Ephemeral JWT Token

    Note over User,EVM: 2. Document Access & Policy-at-Time Verification
    User->>UI: Request Asset Download (Asset ID)
    UI->>API: GET /api/assets/:id/download (JWT Auth)
    API->>EVM: Check AccessControl.sol (isValid(assetId, userDID, now))
    EVM-->>API: Policy Confirmed Active (Version #k)
    API->>EVM: Log On-Chain Access Event (AssetAccessed)
    API->>DB: Fetch Encrypted Payload & AES Salt
    API->>API: Decrypt Payload (AES-256-GCM)
    API->>API: Generate Cryptographic Proof Bundle
    API-->>UI: Stream Decrypted Asset + X-Proof-Bundle Header
    UI-->>User: Download Document & Proof Certificate
```

---

## 🚀 Quick Start: Choose Your Launch Option

PRAMAAN supports two ways to launch the complete development environment:
1. **Option A (Recommended)**: 1-Command Unified Startup — coordinates all 4 services automatically.
2. **Option B**: Manual 4-Terminal Startup — step-by-step control over each tier.

### 1. Prerequisites

Ensure you have the following installed on your system:
- **Node.js**: `v20.x` or `v22.x` (LTS recommended) &bull; `node -v`
- **npm**: `v10.x` or higher &bull; `npm -v`
- **Docker Desktop**: Required to run the PostgreSQL database container &bull; [Download Docker](https://www.docker.com/)
- **Git**: `git --version`

---

### 2. Database Setup (Docker & Prisma)

Before launching the servers, start the PostgreSQL database and initialize the Prisma ORM schema:

```bash
# 1. Navigate to the backend directory
cd trustledger/backend

# 2. Start PostgreSQL via Docker Compose
docker compose up -d

# 3. Verify PostgreSQL is healthy on port 5432
docker ps

# 4. Generate the Prisma client & run database migrations
npx prisma generate
npx prisma migrate dev --name init

# 5. Return to the root folder
cd ../..
```

> [!TIP]
> The database connection string is pre-configured in `trustledger/backend/.env`:  
> `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/trustledger?schema=public"`

---

### Option A: 1-Command Unified Startup (Recommended)

Run the entire ecosystem with **one single command** from the repository root:

```bash
npm run start:all
```

*Or on Windows PowerShell:*
```powershell
./start-all.ps1
```

#### What happens behind the scenes:
1. **Database Check**: Verifies PostgreSQL connectivity on port `5432`.
2. **Blockchain EVM**: Spawns `npx hardhat node` on `http://127.0.0.1:8545`.
3. **Automated Contract Deployment**: Compiles and deploys `IdentityRegistry.sol`, `AccessControl.sol`, and `AssetRegistry.sol` in the required dependency order, automatically writing freshly deployed contract addresses into `backend/.env`.
4. **Backend Engine**: Boots the Express/TypeScript API service strictly on **`http://localhost:3000`**.
5. **Next.js Frontend**: Boots the Next.js 16 Web dApp strictly on **`http://localhost:3001`**.
6. **Graceful Shutdown**: Pressing `Ctrl + C` cleanly terminates all child processes simultaneously with zero leftover zombie ports.

---

### Option B: Manual 4-Terminal Startup

If you prefer granular control, open 4 separate terminal windows:

#### Terminal 1: Local Hardhat Blockchain (Port 8545)
```bash
cd trustledger/contracts
npx hardhat node
```
*Keep this terminal running. It hosts the local EVM node with 20 pre-funded test accounts.*

#### Terminal 2: Contract Deployment & Address Wiring
```bash
cd trustledger/contracts
npx hardhat run scripts/deploy.js --network localhost
```
*Deploys the smart contracts and automatically injects the deployed contract addresses into `backend/.env`.*

#### Terminal 3: PRAMAAN Backend Engine (Port 3000)
```bash
cd trustledger/backend
npm start
```
*Starts the Express server on `http://localhost:3000`. Strict API route enforcement & EIP-712 challenge verification.*

#### Terminal 4: PRAMAAN Frontend Web App (Port 3001)
```bash
cd trustledger/frontend
npm run dev
```
*Starts Next.js on `http://localhost:3001` with Turbopack. Access the dApp in your browser.*

---

## 🔒 Smart Contracts Architecture

The smart contracts are located in `trustledger/contracts/contracts/` and must be deployed in this exact sequence:

```
IdentityRegistry.sol ──> AccessControl.sol ──> AssetRegistry.sol
```

| Contract | Purpose | Core Functions / Events |
| :--- | :--- | :--- |
| **`IdentityRegistry.sol`** | Manages DIDs, roles (`ADMIN`, `MANAGER`, `AUDITOR`, `USER`), and public keys. | `registerIdentity()`, `revokeIdentity()`, `getIdentity()`, `hasRole()` |
| **`AccessControl.sol`** | Enforces versioned temporal RBAC policies and validity timestamps. | `grantAccess()`, `revokeAccess()`, `isValid()`, `getPolicyAtTime()` |
| **`AssetRegistry.sol`** | Immutable register of encrypted document digests and ownership. | `registerAsset()`, `transferAsset()`, `logAccessEvent()`, `getAsset()` |

---

## 🛡 Cryptographic Security Model

- **Document Encryption**: Off-chain symmetric encryption with **AES-256-GCM** (Galois/Counter Mode), guaranteeing both confidentiality and ciphertext integrity.
- **Content Hashing**: Cryptographic document fingerprinting with **SHA-256**.
- **Wallet Authentication**: **EIP-712** typed structured data signing. Users sign domain-bound challenge payloads with MetaMask/Coinbase Wallet — no plaintext passwords.
- **Audit Verifier**: Public verification endpoint (`/verify`) decrypts and audits proof bundles client-side against the on-chain Merkle root.

---

## 📁 Repository Directory Structure

```
TrustLedger/
├── package.json                 # Monorepo root startup scripts (npm run start:all)
├── start-all.ps1                # 1-Click Windows PowerShell launcher
├── README.md                    # Root project documentation (this file)
└── trustledger/
    ├── package.json             # Workspace package config
    ├── start-all.js             # Automated cross-platform stack orchestrator
    ├── start-all.ps1            # Local PowerShell launcher
    │
    ├── contracts/               # Solidity Smart Contracts (Hardhat)
    │   ├── contracts/           # IdentityRegistry, AccessControl, AssetRegistry
    │   ├── scripts/deploy.js    # Ordered deployment script with auto-.env injection
    │   ├── test/                # Unit test suites (Mocha/Chai)
    │   └── hardhat.config.js    # Hardhat EVM network configuration
    │
    ├── backend/                 # Node.js + TypeScript API Engine (Port 3000)
    │   ├── src/                 # Controllers, Repositories, Services, Routes
    │   ├── prisma/              # Schema definitions and database migrations
    │   ├── docker-compose.yml   # PostgreSQL container configuration
    │   └── .env                 # Automatically populated on contract deployment
    │
    ├── frontend/                # Next.js 16 Web Application (Port 3001)
    │   ├── app/                 # App Router (pages: /, /identities, /assets, /verify...)
    │   ├── components/          # UI components, NavBar, 3D ASCII graphics
    │   ├── public/              # High-res PRAMAAN logo, icon, and favicon assets
    │   └── lib/                 # AuthContext, ThemeContext, API client
    │
    └── docs/                    # Technical specifications (Contracts, Backend, Data Model)
```

---

## ❓ Troubleshooting & FAQ

### Port Already in Use (3000 or 3001)
If a terminal crashes or is closed abruptly without `Ctrl + C`, a previous process may linger:
- **Windows (PowerShell)**:
  ```powershell
  # Find PID on port 3000 or 3001
  netstat -ano | findstr :3000
  # Terminate by PID
  taskkill /PID <PID> /F
  ```
- The frontend is strictly locked to port `3001` via `next dev -p 3001` to prevent collisions with the backend on `3000`.

### Contract Bytecode Mismatch after Hardhat Restart
Every local Hardhat node restart wipes the in-memory chain back to block zero. If you restart `npx hardhat node`, you **must re-deploy contracts** (`npx hardhat run scripts/deploy.js --network localhost` or run `npm run start:all`). The deploy script will automatically update `backend/.env` with fresh contract addresses.

### Database Connection Refused (`localhost:5432`)
Ensure Docker Desktop is running and run `docker compose up -d` in `trustledger/backend`.

---

## 📜 License & SIH Disclaimer

Built as a submission for **Smart India Hackathon (SIH 2026)** under **Problem Statement 26125** for **Bharat Electronics Limited (BEL)**. Distributed under the MIT License.
