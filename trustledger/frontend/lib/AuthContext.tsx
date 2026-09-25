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
  switchToHardhatNetwork,
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
  secondsRemaining: number | null;
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

  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

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
    const handleAccountsChanged = (accounts: unknown) => {
      const accs = accounts as string[];
      if (!accs || accs.length === 0) {
        setState((s) => ({
          ...s,
          address: null,
          did: null,
          token: null,
          claims: null,
          error: null,
        }));
      } else {
        setState((s) => {
          if (s.address && accs[0].toLowerCase() !== s.address.toLowerCase()) {
            return {
              ...s,
              address: null,
              did: null,
              token: null,
              claims: null,
              error: null,
            };
          }
          return s;
        });
      }
    };

    const handleChainChanged = () => {
      checkNetwork();
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    return () => {
      cancelled = true;
      window.ethereum?.removeListener("accountsChanged", handleAccountsChanged);
      window.ethereum?.removeListener("chainChanged", handleChainChanged);
    };
  }, [checkNetwork]);

  const loginWithWallet = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const address = await connectWallet();
      let chainId = await getCurrentChainId();
      let isOnHardhat = chainId === HARDHAT_CHAIN_ID;

      // If user's wallet is on Mainnet/Sepolia/etc., automatically trigger MetaMask's network switch prompt
      if (!isOnHardhat) {
        try {
          await switchToHardhatNetwork();
          chainId = await getCurrentChainId();
          isOnHardhat = chainId === HARDHAT_CHAIN_ID;
        } catch (switchErr: unknown) {
          const switchMsg =
            switchErr instanceof Error ? switchErr.message : String(switchErr);
          setState((s) => ({
            ...s,
            loading: false,
            isOnHardhat: false,
            error: `Wallet is on chain ID ${chainId}. Please switch to Hardhat Local (${HARDHAT_CHAIN_ID}) in MetaMask. ${switchMsg}`,
          }));
          return;
        }
      }

      if (!isOnHardhat) {
        setState((s) => ({
          ...s,
          loading: false,
          isOnHardhat: false,
          error: `Wallet is connected to chain ID ${chainId}, not the local Hardhat network (${HARDHAT_CHAIN_ID}). Switch networks in MetaMask before authenticating.`,
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
    } catch (err: unknown) {
      let message =
        err instanceof ApiRequestError
          ? `${err.message} (${err.code})`
          : err instanceof Error
          ? err.message
          : "Unknown error during authentication.";

      const errCode = (err as { code?: number | string })?.code;
      if (
        message.includes("already pending") ||
        message.includes("eth_requestAccounts") ||
        errCode === -32002
      ) {
        message =
          "MetaMask has an approval window open in the background! Please click the MetaMask fox icon in your browser toolbar to approve.";
      } else if (
        message.includes("User rejected") ||
        message.includes("user rejected") ||
        errCode === 4001
      ) {
        message = "Connection or signature request was cancelled in MetaMask.";
      }

      setState((s) => ({ ...s, loading: false, error: message }));
    }
  }, []);

  const logout = useCallback(() => {
    setState((s) => ({
      ...s,
      address: null,
      did: null,
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

  useEffect(() => {
    if (!state.claims?.exp || !effectiveToken) {
      setSecondsRemaining(null);
      return;
    }

    const updateRemaining = () => {
      const remaining = Math.max(
        0,
        state.claims!.exp - Math.floor(Date.now() / 1000)
      );
      setSecondsRemaining(remaining);
      if (remaining <= 0) {
        logout();
      }
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);
    return () => clearInterval(interval);
  }, [state.claims, effectiveToken, logout]);

  // Prompt user before reload if active authenticated session is present
  useEffect(() => {
    if (!effectiveToken) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      try {
        sessionStorage.setItem("pramaan_session_reloaded", "true");
      } catch {}
      e.preventDefault();
      e.returnValue = "Reloading will terminate your active cryptographic session. Are you sure you want to reload?";
      return e.returnValue;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [effectiveToken]);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        token: effectiveToken,
        secondsRemaining,
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
