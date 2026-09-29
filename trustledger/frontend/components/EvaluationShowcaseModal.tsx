"use client";

import React, { useEffect } from "react";

interface EvaluationShowcaseModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function EvaluationShowcaseModal({ isOpen, onClose }: EvaluationShowcaseModalProps) {
  // Close with Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 md:p-8 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      {/* Spacious, Minimalist Container */}
      <div className="relative w-full max-w-4xl rounded-3xl border border-white/10 bg-[#0f172a] shadow-2xl p-6 sm:p-9 md:p-10 text-slate-100 font-sans space-y-6">
        
        {/* Header Row */}
        <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white font-sans">
                PRAMAAN
              </h2>
              <span className="text-xs sm:text-sm font-semibold px-3 py-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300">
                SIH PS 26125 · Team ID: 152562
              </span>
            </div>
            <p className="text-sm sm:text-base text-slate-400 font-normal">
              Zero-Trust Defense Asset Access Control &amp; Cryptographic Temporal Audit Ledger
            </p>
          </div>

          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full border border-white/10 hover:border-white/30 bg-slate-800/80 hover:bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition-all text-base shrink-0"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Razor-Sharp 2-Sentence Disclaimer Banner */}
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5 sm:p-6 flex items-start gap-4 sm:gap-5">
          <span className="text-2xl sm:text-3xl shrink-0 mt-0.5">⚠️</span>
          <div className="space-y-1.5">
            <h3 className="text-base sm:text-lg font-bold text-amber-300">
              Cloud Demo Preview
            </h3>
            <p className="text-sm sm:text-base text-amber-100/90 leading-relaxed font-normal">
              You are viewing the online interface preview for SIH PS 26125 evaluation. Smart contracts and air-gapped ledger execution run live on our presentation hardware.
            </p>
          </div>
        </div>

        {/* 3 Brief High-Impact Points (Under 15 Words Each) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-1">
          {/* Point 1 */}
          <div className="rounded-2xl border border-white/10 bg-slate-800/50 p-5 sm:p-6 space-y-2.5">
            <div className="flex items-center gap-2.5 text-emerald-400">
              <span className="text-xl sm:text-2xl">⏱️</span>
              <h4 className="text-base sm:text-lg font-bold text-white">Time-Machine Audit</h4>
            </div>
            <p className="text-sm sm:text-[15px] text-slate-300 leading-relaxed font-normal">
              Proves whether access was authorized at the exact historical moment, surviving future revocations.
            </p>
          </div>

          {/* Point 2 */}
          <div className="rounded-2xl border border-white/10 bg-slate-800/50 p-5 sm:p-6 space-y-2.5">
            <div className="flex items-center gap-2.5 text-amber-400">
              <span className="text-xl sm:text-2xl">👥</span>
              <h4 className="text-base sm:text-lg font-bold text-white">Dual Custody (NIST AC-5)</h4>
            </div>
            <p className="text-sm sm:text-[15px] text-slate-300 leading-relaxed font-normal">
              Requires cryptographic co-signatures from two ranks; the server holds zero approver keys.
            </p>
          </div>

          {/* Point 3 */}
          <div className="rounded-2xl border border-white/10 bg-slate-800/50 p-5 sm:p-6 space-y-2.5">
            <div className="flex items-center gap-2.5 text-sky-400">
              <span className="text-xl sm:text-2xl">🏭</span>
              <h4 className="text-base sm:text-lg font-bold text-white">BEL Ecosystem Fit</h4>
            </div>
            <p className="text-sm sm:text-[15px] text-slate-300 leading-relaxed font-normal">
              Operates additively alongside BEL SecureLedger physical tracking and BEL SecureDoc certificates.
            </p>
          </div>
        </div>

        {/* Footer Row: Clean References + Large Action Button */}
        <div className="pt-5 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
          <div className="flex items-center gap-3 sm:gap-4 text-xs sm:text-sm text-slate-400 flex-wrap font-normal">
            <span className="text-slate-500 font-semibold">Official References:</span>
            <a
              href="https://bel-india.in/software/software-products/blockchain-based-solutions-product/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-200 hover:text-white hover:underline transition-colors font-medium"
            >
              🇮🇳 BEL Blockchain ↗
            </a>
            <span className="text-slate-600 hidden sm:inline">•</span>
            <a
              href="https://csrc.nist.gov/pubs/ir/8403/final"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-200 hover:text-white hover:underline transition-colors font-medium"
            >
              🏛️ NIST IR 8403 ↗
            </a>
            <span className="text-slate-600 hidden sm:inline">•</span>
            <a
              href="https://github.com/RajveerSinghBisht/TrustLedger/tree/main"
              target="_blank"
              rel="noopener noreferrer"
              className="text-slate-200 hover:text-white hover:underline transition-colors font-medium"
            >
              📂 GitHub Repo ↗
            </a>
          </div>

          <button
            onClick={onClose}
            className="px-8 py-3 rounded-xl bg-white hover:bg-slate-200 text-slate-950 font-bold text-sm sm:text-base transition-all shadow-xl hover:scale-[1.02] shrink-0"
          >
            Continue to Live Demo →
          </button>
        </div>

      </div>
    </div>
  );
}
