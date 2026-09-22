"use client";

import { useAuth } from "@/lib/AuthContext";
import { switchToHardhatNetwork, hasMetaMask } from "@/lib/wallet";
import { useState } from "react";
import { Spinner } from "@/components/ui";

export function NetworkBanner() {
  const { isOnHardhat, checkNetwork } = useAuth();
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  if (!hasMetaMask()) {
    return (
      <div className="bg-(--warning-bg) border-b border-(--warning-border) px-4 py-2 text-sm text-(--warning)">
        MetaMask was not detected (<code>window.ethereum</code> is undefined). Install the MetaMask browser extension to use this app — nothing here can be faked without a real wallet.
      </div>
    );
  }

  if (isOnHardhat === false) {
    return (
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
    );
  }

  return null;
}
