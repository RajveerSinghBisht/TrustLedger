import { BrowserProvider, getAddress } from "ethers";
import type { JwtClaims } from "./types";
export const HARDHAT_CHAIN_ID = 31337;
export const HARDHAT_CHAIN_ID_HEX = "0x7a69"; // 31337 in hex
export const HARDHAT_RPC_URL = "http://127.0.0.1:8545";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
      isMetaMask?: boolean;
    };
  }
}

export function hasMetaMask(): boolean {
  return typeof window !== "undefined" && !!window.ethereum;
}

export async function getProvider(): Promise<BrowserProvider> {
  if (!window.ethereum) {
    throw new Error("MetaMask (window.ethereum) not found. Install MetaMask to continue.");
  }
  return new BrowserProvider(window.ethereum);
}

export async function connectWallet(): Promise<string> {
  const provider = await getProvider();
  const accounts = (await provider.send("eth_requestAccounts", [])) as string[];
  if (!accounts.length) {
    throw new Error("No accounts returned by wallet.");
  }
  return accounts[0];
}

export async function getCurrentChainId(): Promise<number> {
  const provider = await getProvider();
  const network = await provider.getNetwork();
  return Number(network.chainId);
}

/**
 * Prompts MetaMask to switch to the local Hardhat network. If the chain
 * hasn't been added to MetaMask yet, falls back to adding it.
 * This does NOT run automatically on page load — it's user-initiated from
 * a visible "Switch network" action, since silently reconfiguring a
 * user's wallet without a click is exactly the kind of thing MetaMask
 * itself blocks/warns on.
 */
export async function switchToHardhatNetwork(): Promise<void> {
  if (!window.ethereum) throw new Error("MetaMask not found.");
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: HARDHAT_CHAIN_ID_HEX }],
    });
  } catch (err: unknown) {
    // 4902 = chain not added to MetaMask yet
    const code = (err as { code?: number })?.code;
    if (code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: HARDHAT_CHAIN_ID_HEX,
            chainName: "Hardhat Local",
            rpcUrls: [HARDHAT_RPC_URL],
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          },
        ],
      });
    } else {
      throw err;
    }
  }
}

/**
 * Signs the exact message text with the wallet's private key, unmodified.
 * The backend spec is explicit: the client must sign the returned message
 * text as-is, byte for byte — no re-derivation, no reformatting, since the
 * server reconstructs the same canonical text server-side and compares it
 * byte-for-byte. Any client-side transformation of `message` before
 * signing would break verification.
 */
export async function signMessageExact(message: string): Promise<string> {
  const provider = await getProvider();
  const signer = await provider.getSigner();
  return signer.signMessage(message);
}

/**
 * DID format per DATA_MODEL.md: `did:trustledger:<address>`.
 * Address should be checksummed as returned by the wallet.
 */
export function addressToDid(address: string): string {
  return `did:trustledger:${getAddress(address)}`;
}

/**
 * Decodes a JWT payload WITHOUT verifying its signature. This is a
 * frontend-only convenience read (e.g. to show role/expiry in the UI) — it
 * must never be treated as authoritative or used as an auth decision.
 * The backend is the only party that verifies the signature; per the spec,
 * even the backend doesn't trust the JWT's cached `role` claim for
 * privileged authorization decisions, so the frontend trusting it even
 * less is consistent, not extra caution.
 */
export function decodeJwtPayload(token: string): JwtClaims | null {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as JwtClaims;
  } catch {
    return null;
  }
}

export function isJwtExpired(claims: JwtClaims): boolean {
  return Date.now() >= claims.exp * 1000;
}
