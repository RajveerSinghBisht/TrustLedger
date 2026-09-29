"use client";

import { useAuth } from "@/lib/AuthContext";
import { switchToHardhatNetwork, hasMetaMask } from "@/lib/wallet";
import { useState } from "react";
import { Spinner } from "@/components/ui";

export function NetworkBanner() {
  const { isOnHardhat, checkNetwork, error, clearError, token } = useAuth();
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  if (!hasMetaMask()) {
    return null;
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

      {token && isOnHardhat === false && !error && (
        <div className="bg-slate-900 border-b border-cyan-500/30 px-4 py-2 text-xs font-mono text-slate-300 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-cyan-400 font-bold shrink-0">⚡ CLOUD SHOWCASE:</span>
            <span>MetaMask connected to external network. On-chain defense transactions execute against local air-gapped node (31337) during live jury demonstration.</span>
          </div>
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
            className="shrink-0 inline-flex items-center gap-1.5 rounded border border-cyan-500/40 bg-cyan-950/60 px-3 py-1 text-xs font-medium text-cyan-300 hover:bg-cyan-900/60 transition-colors disabled:opacity-50"
          >
            {switching && <Spinner />}
            {switching ? "Switching..." : "Connect Local Node"}
          </button>
          {switchError && <span className="text-rose-400 text-xs">{switchError}</span>}
        </div>
      )}
    </>
  );
}
