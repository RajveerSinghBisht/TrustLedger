# PRAMAAN Frontend

Next.js (App Router, TypeScript, Tailwind) frontend for PRAMAAN, built
against `BACKEND_SPEC.md`, `DATA_MODEL.md`, and specifications.

## Setup

```bash
npm install
npm run dev
```

Runs on `http://localhost:3001` by default if `3000` is taken (the backend
owns `3000` per the integration doc) — check the terminal output for the
actual port `next dev` picks.

## Required before anything works

1. A local Hardhat node running (`npx hardhat node`).
2. The PRAMAAN backend running at `http://localhost:3000` — **with CORS
   enabled** (`app.use(cors())` in `backend/src/index.ts`). As of the last
   integration doc, this was NOT yet done on the backend and will block
   every request from this frontend with a browser CORS error. This is a
   backend-side fix, not something fixable from here.
3. MetaMask installed, with one of Hardhat's funded local test accounts
   imported, pointed at RPC `http://127.0.0.1:8545`, chain ID `31337`. The
   app will prompt to switch/add this network if MetaMask is on the wrong
   one.

## Config

`.env.local`:
```
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000
```
Change this if the backend runs elsewhere.

## Structure

- `lib/types.ts` — types mirroring `DATA_MODEL.md` field-for-field (frozen
  names, don't rename).
- `lib/api.ts` — typed fetch wrappers for every documented endpoint. Errors
  surface `{ error, code }` per spec; UI reads `.code`, not the message
  string.
- `lib/wallet.ts` — MetaMask connection, network switching, exact-text
  message signing (does not reformat the challenge message before signing
  — the backend compares byte-for-byte).
- `lib/AuthContext.tsx` — session state (address/DID/JWT/claims). Token is
  held in memory only, not localStorage — a 15-minute JWT surviving reload
  via localStorage seemed like an unnecessary footgun for a security demo,
  so a reload re-requires signing in. Change this if you'd rather persist it.
- `app/*/page.tsx` — the seven screens, in the exact order specified:
  1. `/identities` — register identities (ADMIN only, enforced server-side)
  2. `/assets` — upload/register an asset (multipart/form-data)
  3. `/permissions` — grant AND revoke live on one screen (same endpoint,
     `state: GRANTED | REVOKED`)
  4. `/download` — downloads the file AND separately surfaces the
     `X-Proof-Bundle` response header (a plain `<a href>` can't read
     response headers, so this does a real `fetch`, reads the header,
     then triggers the file save via Blob + object URL)
  5. (revoke is on `/permissions`, see above)
  6. `/policy-check` — the core USP screen. Two side-by-side timestamp
     panels (not one query box) so a before/after-revoke contrast in
     `wasLegitimate` is visually obvious. No auth required, per spec.
  7. `/verify` — proof bundle verification. No auth, styled to visually
     read as a standalone public tool rather than a logged-in feature.

## Things flagged during the build, not fixed silently

- **"Offline verification"** — the original README describes proof bundles
  as verifiable "completely offline." `DATA_MODEL.md` explicitly corrects
  this: it's Level 2 (independent *online* verification, requires RPC
  access), not Level 3 (true offline, unbuilt). The `/verify` screen's copy
  follows `DATA_MODEL.md`'s corrected language, not the README's.
- **JWT `role` claim** — used only for UI gating (hide/disable buttons a
  role can't use). Never treated as an authorization decision; the backend
  re-verifies role fresh from `IdentityRegistry` for every privileged write
  and doesn't trust this claim either, per `BACKEND_SPEC.md`.
- **Error codes** — the integration doc says to key error handling off
  `code`, but only documents one actual code (`IDENTITY_NOT_FOUND`). The
  API layer reads `.code` generically and displays whatever the backend
  sends; no fabricated code list was added.
- **CORS** — not fixable from this side; see Setup above.
