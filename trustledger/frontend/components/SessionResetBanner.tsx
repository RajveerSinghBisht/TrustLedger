"use client";

import { useState, useEffect } from "react";

export function SessionResetBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      if (sessionStorage.getItem("pramaan_session_reloaded") === "true") {
        sessionStorage.removeItem("pramaan_session_reloaded");
        setShow(true);
      }
    }
  }, []);

  if (!show) return null;

  return (
    <div className="bg-sky-500/10 border-b border-sky-500/30 px-4 sm:px-8 py-2 text-xs font-mono text-sky-400 flex items-center justify-between gap-4 transition-all">
      <div className="flex items-center gap-2.5">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)]" />
        </span>
        <span>
          <strong>SESSION_PURGED:</strong> The page was reloaded. In-memory cryptographic session tokens are purged on reload for zero-trust defense compliance. Please reconnect your wallet.
        </span>
      </div>
      <button
        type="button"
        onClick={() => setShow(false)}
        className="shrink-0 text-sky-400/80 hover:text-sky-200 border border-sky-500/30 hover:bg-sky-500/20 px-2.5 py-0.5 rounded text-[11px] transition-colors"
      >
        DISMISS
      </button>
    </div>
  );
}
