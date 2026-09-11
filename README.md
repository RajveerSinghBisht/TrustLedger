# TrustLedger

Blockchain-based identity, access control, and digital asset management platform.
Built for SIH Problem Statement 26125 (Bharat Electronics Limited).

## What this is

TrustLedger secures compliance, maintenance, and spares-authorization records for
BEL systems with 20-30 year service lives. Every identity is a Decentralized
Identifier (DID). Every record is hashed, encrypted off-chain, and represented
on-chain as a unique NFT. Role-Based Access Control (Admin/Manager/Auditor/User)
is enforced by smart contracts, not application code.

Two things make this different from a standard RBAC + NFT system:

1. **Policy-at-the-time verification** — permissions are stored as a versioned
   timeline, not a single current-state row. The system can prove whether an
   access was legitimate under the rules that existed at the exact moment it
   happened, not just what the rules are now.
2. **Portable proof-of-access** — every verified access generates a signed,
   exportable proof bundle that any third party (auditor, court, depot) can
   verify completely offline, without ever trusting or contacting our platform.

## Repo structure

```
trustledger/
├── contracts/     Solidity smart contracts (Hardhat project)
├── backend/       Node.js + TypeScript API layer
├── frontend/      React app (built after contracts + backend are stable)
└── docs/          Specifications — READ THESE BEFORE WRITING CODE
```

## Before you write a single line of code

Read the spec document for your piece, in full, first:

- Working on smart contracts? Read `docs/CONTRACTS_SPEC.md`
- Working on the backend API? Read `docs/BACKEND_SPEC.md`
- Either piece? Also read `docs/DATA_MODEL.md` — both sides depend on it

**The function signatures, API routes, and data shapes in these documents are
frozen.** Do not change a signature, route, or field name locally because it
seemed more convenient — if something in a spec seems wrong or incomplete,
flag it to the team before writing code against a workaround. A silent local
deviation is the single most common way this kind of split build breaks on
integration day.

## Tech stack (locked)

- **Contracts:** Solidity, Hardhat, local Hardhat network (no testnet for now)
- **Backend:** Node.js, TypeScript, Express (or similar), ethers.js (to talk
  to contracts), PostgreSQL (off-chain metadata)
- **Frontend:** React (built later, once contracts + backend are stable)
- **Encryption/Hashing:** AES-256-GCM (records), SHA-256 (fingerprints)

## Setup

Each subdirectory (`contracts/`, `backend/`) has its own `package.json` and
its own setup instructions once scaffolded. Root-level setup:

1. Install Node.js (LTS — 20.x or 22.x), Git, VS Code
2. Clone this repo
3. Follow the setup section inside `contracts/README.md` and
   `backend/README.md` respectively for your piece

## Who's building what

- **Contracts (IdentityRegistry, AccessControl, AssetRegistry, permission
  history):** [assign name]
- **Backend API (hashing, encryption, DB, calling contracts):** [assign name]
- **Frontend:** [assign name, once contracts + backend are stable]

## Questions or spec issues

If a spec document is ambiguous, contradicts itself, or doesn't cover a case
you've hit — stop and raise it. Do not guess and continue; guessing is how
independent builds stop fitting together.
