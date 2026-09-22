"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from "react";
import { postChallenge, postVerify, ApiRequestError } from "./api";
import {
  connectWallet,
  signMessageExact,
  addressToDid,
  decodeJwtPayload,
  isJwtExpired,
  getCurrentChainId,
  HARDHAT_CHAIN_ID,
} from "./wallet";
import type { JwtClaims } from "./types";

interface AuthState {
  address: string | null;
  did: string | null;
  token: string | null;
  claims: JwtClaims | null;
  isOnHardhat: boolean | null; // null = not checked yet
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  loginWithWallet: () => Promise<void>;
  logout: () => void;
  checkNetwork: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Session is intentionally memory-only (React state), not localStorage.
// A 15-minute JWT surviving a page reload via localStorage would be a
// minor but avoidable footgun for a security-focused demo app — re-auth
// on reload is the more honest behavior here given what this app is.

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    address: null,
    did: null,
    token: null,
    claims: null,
    isOnHardhat: null,
    loading: false,
    error: null,
  });

  const checkNetwork = useCallback(async () => {
    try {
      const chainId = await getCurrentChainId();
      setState((s) => ({ ...s, isOnHardhat: chainId === HARDHAT_CHAIN_ID }));
    } catch {
      setState((s) => ({ ...s, isOnHardhat: null }));
    }
  }, []);

  useEffect(() => {
    // Passive check on mount if a wallet is already present/connected —
    // does not prompt anything, just reads current state. Self-contained
    // (doesn't route through the checkNetwork callback) so the effect
    // owns its own async boundary rather than synchronously invoking a
    // function that sets state, per react-hooks/set-state-in-effect.
    if (typeof window === "undefined" || !window.ethereum) return;
    let cancelled = false;
    (async () => {
      try {
        const chainId = await getCurrentChainId();
        if (!cancelled) {
          setState((s) => ({ ...s, isOnHardhat: chainId === HARDHAT_CHAIN_ID }));
        }
      } catch {
        if (!cancelled) setState((s) => ({ ...s, isOnHardhat: null }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loginWithWallet = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const address = await connectWallet();
      const chainId = await getCurrentChainId();
      const isOnHardhat = chainId === HARDHAT_CHAIN_ID;
      if (!isOnHardhat) {
        setState((s) => ({
          ...s,
          loading: false,
          isOnHardhat: false,
          error: `Wallet is connected to chain ID ${chainId}, not the local Hardhat network (${HARDHAT_CHAIN_ID}). Switch networks before authenticating.`,
        }));
        return;
      }

      const did = addressToDid(address);

      // Step 1: challenge
      const { message } = await postChallenge(did);

      // Step 2: sign EXACTLY the returned text, no modification
      const signature = await signMessageExact(message);

      // Step 3: verify
      const { token } = await postVerify(did, message, signature);
      const claims = decodeJwtPayload(token);

      setState((s) => ({
        ...s,
        address,
        did,
        token,
        claims,
        isOnHardhat: true,
        loading: false,
        error: null,
      }));
    } catch (err) {
      const message =
        err instanceof ApiRequestError
          ? `${err.message} (${err.code})`
          : err instanceof Error
          ? err.message
          : "Unknown error during authentication.";
      setState((s) => ({ ...s, loading: false, error: message }));
    }
  }, []);

  const logout = useCallback(() => {
    setState((s) => ({
      ...s,
      token: null,
      claims: null,
      error: null,
    }));
  }, []);

  const clearError = useCallback(() => {
    setState((s) => ({ ...s, error: null }));
  }, []);

  // Surface (not auto-hide) expiry — a stale token should visibly stop
  // working rather than silently pretend to still be valid.
  const effectiveToken =
    state.token && state.claims && !isJwtExpired(state.claims)
      ? state.token
      : null;

  return (
    <AuthContext.Provider
      value={{
        ...state,
        token: effectiveToken,
        loginWithWallet,
        logout,
        checkNetwork,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
