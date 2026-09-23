<p align="center">
  <img src="public/pramaan-icon.png" width="100" alt="PRAMAAN Emblem" />
</p>

# 💻 PRAMAAN — Frontend Web Application

The PRAMAAN frontend is an enterprise decentralized web application built with **Next.js 16 (Turbopack)**, **React 19**, and **Tailwind CSS v4**.

It provides an intuitive interface for decentralized identity management, encrypted document vaulting, temporal access policies, and client-side cryptographic audit verification.

---

## ⚡ Server Configuration

- **Port**: Strictly locked to **`http://localhost:3001`** via `next dev -p 3001`.
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
*Next.js will compile with Turbopack and launch on **`http://localhost:3001`**.*

### 3. Production Build
```bash
npm run build
npm start
```

---

## 🎨 Design & Aesthetic Features

1. **Dual Warm Off-White / Dark Theme Engine**:
   - **Light Mode**: Rich, warm linen off-white (`#f5f2eb`), cream porcelain surfaces (`#fdfbf7`), and deep espresso ink typography (`#14110f`).
   - **Dark Mode**: Tactical matte obsidian (`#080503`) with emerald accents.
   - **Performance**: High-performance theme switching with zero layout thrashing or browser paint lag.
2. **PRAMAAN Emblem & Futuristic Typography**:
   - Official 3D hexagonal blockchain logo emblem.
   - Branded with the Google Font **Orbitron** (`.font-pramaan`) across all brand elements.
3. **Interactive 3D Mathematical Graphics**:
   - **AsciiSphere**: Real-time 3D Euler rotation matrix rendered as interactive ASCII particles.
   - **AsciiCryptoCube**: Rotating 3D wireframe tetrahedron for cryptographic asset representations.
   - **AsciiWaveField**: Fluid sine wave matrix background.

---

## 🧭 Page Routes & Modules

| Route | Module Name | Description |
| :--- | :--- | :--- |
| **`/`** | **Command Center** | Hero dashboard, live consensus node telemetry (IST), interactive 7-step lifecycle sequencer, and technical specifications. |
| **`/identities`** | **DID Registry** | Admin portal for registering, querying, and managing on-chain DIDs and roles. |
| **`/assets`** | **Document Vault** | Upload confidential documents for off-chain AES-256-GCM encryption and on-chain hash pinning. |
| **`/permissions`**| **Policy Manager** | Grant and revoke access with immutable `validFrom` and `validUntil` timestamps. |
| **`/download`** | **Secure Dispatch** | Request authorized files, verify on-chain permissions, and export cryptographic `X-Proof-Bundle` headers. |
| **`/policy-check`**| **Policy-at-Time** | Historical audit tool proving whether a DID had access rights at any specific second in the past. |
| **`/verify`** | **Verify Bundle** | Zero-login standalone portal allowing any auditor or court to inspect and verify an offline proof bundle. |

---

## 🔗 Web3 Integration

- **Wallet Support**: MetaMask, Rabby, Coinbase Wallet via Ethers.js v6.
- **Authentication**: EIP-712 typed structured data signatures; session maintained via client-side AuthContext.
