"use client";

import { useAuth } from "@/lib/AuthContext";
import { switchToHardhatNetwork, hasMetaMask } from "@/lib/wallet";
import { useState } from "react";
import { Spinner } from "@/components/ui";

export function NetworkBanner() {
  const { isOnHardhat, checkNetwork, error, clearError } = useAuth();
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  if (!hasMetaMask()) {
    return (
      <div className="bg-(--warning-bg) border-b border-(--warning-border) px-4 py-2 text-sm text-(--warning)">
        MetaMask was not detected (<code>window.ethereum</code> is undefined). Install the MetaMask browser extension to use this app — nothing here can be faked without a real wallet.
      </div>
    );
  }

  return (
    <>
      {error && (
        <div className="bg-rose-500/15 border-b border-rose-500/40 px-4 sm:px-8 py-2.5 text-xs font-mono text-rose-300 flex items-center justify-between gap-4 animate-in fade-in">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-bold text-rose-400 shrink-0">⚠️ AUTHENTICATION NOTICE:</span>
            <span className="text-rose-200">{error}</span>
          </div>
          <button
            type="button"
            onClick={clearError}
            className="shrink-0 px-2.5 py-0.5 rounded border border-rose-500/40 hover:bg-rose-500/20 text-[11px] text-rose-200 transition-colors"
          >
            DISMISS
          </button>
        </div>
      )}

      {isOnHardhat === false && !error && (
        <div className="bg-(--warning-bg) border-b border-(--warning-border) px-4 py-2 text-sm text-(--warning) flex items-center justify-between gap-4">
          <span>
            MetaMask is not on the local Hardhat network (<code>http://127.0.0.1:8545</code>, chain ID 31337). Nothing will work until it is — including signing and every contract-backed endpoint.
          </span>
          <button
            onClick={async () => {
              setSwitching(true);
              setSwitchError(null);
              try {
                await switchToHardhatNetwork();
                await checkNetwork();
              } catch (err) {
                setSwitchError(
                  err instanceof Error ? err.message : "Failed to switch network."
                );
              } finally {
                setSwitching(false);
              }
            }}
            disabled={switching}
            className="shrink-0 inline-flex items-center gap-1.5 rounded border border-(--warning-border) bg-(--surface) px-3 py-1 text-xs font-medium text-(--warning) hover:bg-(--warning-bg) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--warning) transition-colors duration-150 disabled:opacity-50"
          >
            {switching ? (
              <>
                <Spinner /> Switching...
              </>
            ) : (
              "Switch network"
            )}
          </button>
          {switchError && <span className="text-(--danger) text-xs">{switchError}</span>}
        </div>
      )}
    </>
  );
}
