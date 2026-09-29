<p align="center">
  <img src="public/pramaan-icon.png" width="100" alt="PRAMAAN Emblem" />
</p>

# 💻 PRAMAAN — Frontend Web Application

The PRAMAAN frontend is an institutional defense and enterprise access control console built with **Next.js 16 (Turbopack)**, **React 19**, and **Tailwind CSS v4**.

It provides an authoritative interface for decentralized identity management, encrypted document vaulting, temporal access policies, dual-custody multi-officer authorization workflows, and independent cryptographic proof verification.

---

## ⚡ Server Configuration

- **Port**: Strictly configured to run on **`http://localhost:3001`** via `next dev -p 3001`.
- **Backend API Gateway**: Pre-configured to communicate with `http://localhost:3000`.
- **Telemetry**: Live Indian Standard Time (IST) 24-hour clock and consensus node latency monitoring.

---

## 🚀 Running the Frontend

### 1. Install Dependencies
```bash
npm install
```

### 2. Launch Development Server
```bash
npm run dev
```
*Next.js compiles with Turbopack and launches on **`http://localhost:3001`**.*

### 3. Production Build & Test
```bash
npm run build
npm start
```
*Compiles all static and dynamic routes with zero TypeScript or hydration warnings.*

---

## 🎨 Design System & Visual Posture

1. **Defense / Institutional C2 Aesthetic**:
   - **Typography**: Paired **IBM Plex Sans** (for clear technical readability) with **IBM Plex Mono** (for cryptographic chrome, timestamps, addresses, and status tags).
   - **Accent Palette**: Tactical desaturated steel-blue (`#7aa2ba` in dark mode, `#1e3a5f` in light mode), avoiding oversaturated consumer fintech tones.
   - **Theme Engine**: Light mode features warm linen surfaces (`#f5f2eb`), cream porcelain layers (`#fdfbf7`), and dark slate typography; Dark mode features deep matte obsidian (`#080503`) with subtle borders.
2. **Interactive Mathematical Graphics**:
   - **AsciiSphere**: Real-time 2D canvas Euler rotation matrix rendered as rotating ASCII particles in the hero.
   - **AsciiCryptoCube**: 3D wireframe visualizer for cryptographic asset representations.
   - **AsciiWaveField**: Fluid sine wave canvas matrix background in the footer.
3. **Restrained Mechanical Feedback**:
   - Clean row-inspection hover highlights (`hover:bg-(--surface-hover)`).
   - Static, non-pulsing state indicators for calm operational confidence.

---

## 🧭 Page Routes & Modules

| Route | Module Name | Description |
| :--- | :--- | :--- |
| **`/`** | **Command Center** | Hero HUD, rotating capability display, live consensus node telemetry, interactive lifecycle sequencer, and Section 8 Project Specification Dossier with Scope Matrix. |
| **`/identities`** | **DID Registry** | Admin portal for registering, querying, and managing on-chain DIDs and roles (`ADMIN`, `MANAGER`, `AUDITOR`, `USER`). |
| **`/assets`** | **Document Vault** | Upload classified documents for off-chain AES-256-GCM encryption with pre-submission blockchain immutability confirmation modal and hash pinning. |
| **`/permissions`**| **Policy Manager** | Single-sig temporal policies (`validFrom`, `validUntil`) plus **Dual-Custody Multi-Officer Authorization** workflow (Maker request, Checker approval, 24h TTL) for CONFIDENTIAL assets. |
| **`/download`** | **Secure Dispatch** | Request authorized documents, trigger on-chain `AssetAccessed` logging, and export cryptographic `X-Proof-Bundle` headers. |
| **`/policy-check`**| **Policy-at-Time** | Historical audit tool proving whether a DID had access rights at any specific second in the past (`checkPermissionAtTime`). |
| **`/verify`** | **Verify Bundle** | Zero-login standalone portal allowing any external auditor to inspect and re-verify proof bundles independently via EVM RPC without backend reliance. |

---

## 🔗 Web3 Integration

- **Wallet Support**: MetaMask, Rabby, Coinbase Wallet via Ethers.js v6.
- **Authentication**: EIP-712 structured data challenges with session management via client-side AuthContext.
- **On-Chain Guards**: Real-time verification checks on all state mutation workflows.
