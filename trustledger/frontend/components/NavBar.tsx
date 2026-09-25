"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useTheme } from "@/lib/ThemeContext";
import { Badge, Spinner } from "@/components/ui";
import { Menu, X, ArrowRight } from "@/components/Icons";
import { useEffect, useState } from "react";

const links = [
  { href: "/", label: "Home", shortLabel: "Home", tag: "00" },
  { href: "/identities", label: "Identities", shortLabel: "Identities", tag: "01" },
  { href: "/assets", label: "Assets", shortLabel: "Assets", tag: "02" },
  { href: "/permissions", label: "Permissions", shortLabel: "Permissions", tag: "03" },
  { href: "/download", label: "Download", shortLabel: "Download", tag: "04" },
  { href: "/policy-check", label: "Policy Check", shortLabel: "Policy", tag: "05" },
  { href: "/verify", label: "Verify Bundle", shortLabel: "Verify", tag: "06" },
];

function formatCountdown(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function getTimerBadgeStyle(sec: number) {
  if (sec <= 60) {
    return {
      container:
        "border-rose-500/70 bg-rose-500/15 text-rose-300 shadow-[0_0_18px_rgba(244,63,94,0.4)] animate-pulse font-bold",
      icon: "🚨",
      title: "CRITICAL: Session expiring in less than 60 seconds! Reconnect to avoid timeout.",
    };
  }
  if (sec <= 300) {
    return {
      container:
        "border-amber-500/60 bg-amber-500/10 text-amber-300 shadow-[0_0_16px_rgba(245,158,11,0.3)] animate-pulse font-semibold",
      icon: "⚠️",
      title: "Session expiring in less than 5 minutes. Reconnect wallet before timeout.",
    };
  }
  return {
    container:
      "border-cyan-500/40 bg-cyan-500/5 text-cyan-300 hover:border-cyan-500/60 shadow-[0_0_12px_rgba(6,182,212,0.16)]",
    icon: "⏱",
    title: "Active 15-minute defense JWT session countdown",
  };
}

export function NavBar() {
  const pathname = usePathname();
  const { address, did, claims, token, secondsRemaining, loading, error, loginWithWallet, logout } =
    useAuth();
  const { theme, toggleTheme } = useTheme();
  const [timeStr, setTimeStr] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    function updateClock() {
      const now = new Date();
      const istTime = now.toLocaleTimeString("en-GB", {
        timeZone: "Asia/Kolkata",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      setTimeStr(`${istTime} IST`);
    }
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-(--border) bg-(--bg)/90 backdrop-blur-md transition-colors duration-300">
      {/* Top Telemetry Ticker Bar */}
      <div className="border-b border-(--border)/60 px-4 sm:px-6 lg:px-8 h-7 flex items-center justify-between text-[11px] font-mono tracking-widest text-(--text-muted) bg-(--surface)/40">
        <div className="flex items-center gap-3 sm:gap-4 overflow-hidden text-ellipsis whitespace-nowrap">
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-(--success) animate-pulse" />
            <span className="text-(--text-primary) font-semibold">ALL_SYSTEMS_OPERATIONAL</span>
          </span>
          <span className="hidden md:inline text-(--border)">|</span>
          <span className="hidden md:inline shrink-0">HARDHAT_NETWORK: 31337</span>
          <span className="hidden 2xl:inline text-(--border)">|</span>
          <span className="hidden 2xl:inline shrink-0">SIH PROTOCOL ENGINE 26125</span>
        </div>
        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          <span className="tabular-nums text-(--text-muted)">{timeStr || "SYSTEM ACTIVE"}</span>
          <span className="text-(--border)">|</span>
          <span className="font-mono text-xs text-(--text-primary)">v1.0.4</span>
        </div>
      </div>

      {/* Main Navigation Bar */}
      <div className="mx-auto max-w-[1600px] w-full px-4 sm:px-6 lg:px-8 h-18 flex items-center justify-between gap-3 xl:gap-6">
        {/* Left: Brand & Navigation Links */}
        <div className="flex items-center gap-3 xl:gap-6 2xl:gap-8 shrink-0">
          <Link href="/" className="flex items-center gap-2.5 sm:gap-3 group shrink-0">
            <div className="relative w-8 h-8 lg:w-9 lg:h-9 shrink-0 transition-transform duration-300 group-hover:scale-105">
              <Image
                src="/pramaan-icon.png"
                alt="PRAMAAN Emblem"
                width={36}
                height={36}
                className="w-full h-full object-contain filter drop-shadow-[0_2px_8px_rgba(16,185,129,0.3)]"
                priority
              />
            </div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-pramaan font-bold tracking-wider text-xl lg:text-2xl text-(--text-primary) group-hover:opacity-85 transition-opacity">
                PRAMAAN
              </span>
              <span className="hidden sm:inline text-(--text-muted) font-mono text-[10px] tracking-widest px-1.5 py-0.5 rounded border border-(--border) bg-(--surface)/60">
                TM
              </span>
            </div>
          </Link>

          {/* Desktop Nav Links */}
          <nav className="hidden lg:flex items-center gap-1 xl:gap-2.5 2xl:gap-4 text-xs font-mono">
            {links.map((l) => {
              const isActive = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`nav-link px-2 py-1 rounded transition-colors duration-200 whitespace-nowrap tracking-wider ${
                    isActive
                      ? "active text-(--text-primary) font-semibold bg-(--surface)"
                      : "text-(--text-muted) hover:text-(--text-primary) hover:bg-(--surface)/50"
                  }`}
                >
                  <span className="hidden 2xl:inline text-(--text-faint) mr-1 text-[10px]">{l.tag}.</span>
                  <span className="hidden xl:inline">{l.label}</span>
                  <span className="xl:hidden">{l.shortLabel}</span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right: Auth State, Session Timer, Actions, Theme Toggle */}
        <div className="flex items-center gap-2 sm:gap-2.5 xl:gap-3 shrink-0">
          {/* Auth State Button */}
          <div className="hidden sm:flex items-center">
            {loading ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-(--border) px-3 py-1.5 text-xs font-mono text-(--text-muted)">
                <Spinner />
                <span>CONNECTING...</span>
              </div>
            ) : token && claims ? (
              <div className="flex items-center gap-2 sm:gap-2.5 xl:gap-3">
                {/* Role Badge with Glowing Radar Beacon */}
                <span className="inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-500/50 hover:bg-emerald-500/10 text-xs font-mono shadow-[0_0_12px_rgba(16,185,129,0.12)] transition-all duration-300 shrink-0">
                  <span className="relative flex h-2 w-2 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 duration-1000" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
                  </span>
                  <span className="text-(--text-muted) tracking-tight">
                    <span className="hidden xl:inline">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
                    <span className="xl:hidden">{address?.slice(0, 4)}...{address?.slice(-3)}</span>
                  </span>
                  <span className="text-(--border)">/</span>
                  <span className="text-emerald-400 font-bold uppercase tracking-wider text-[11px] sm:text-xs">
                    {claims.role}
                  </span>
                </span>

                {/* Session Countdown Badge with Dynamic Glow */}
                {secondsRemaining !== null && (() => {
                  const style = getTimerBadgeStyle(secondsRemaining);
                  return (
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full border text-xs font-mono transition-all duration-300 shrink-0 select-none ${style.container}`}
                      title={style.title}
                    >
                      <span className="text-[11px] leading-none">{style.icon}</span>
                      <span className="tracking-wide tabular-nums">{formatCountdown(secondsRemaining)}</span>
                    </span>
                  );
                })()}

                {/* Refined Disconnect Button */}
                <button
                  type="button"
                  onClick={logout}
                  className="rounded-full border border-(--border)/80 hover:border-rose-500/60 hover:bg-rose-500/10 hover:text-rose-400 hover:shadow-[0_0_14px_rgba(244,63,94,0.25)] bg-(--surface)/70 backdrop-blur-md px-3 sm:px-3.5 py-1.5 text-xs font-mono text-(--text-muted) transition-all duration-200 shrink-0 tracking-wider"
                >
                  DISCONNECT
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={loginWithWallet}
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-xs font-mono font-medium bg-(--text-primary) hover:opacity-90 text-(--bg) rounded-full px-4 sm:px-5 py-2 transition-all duration-300 hover:scale-[1.02] shadow-sm"
              >
                <span>CONNECT WALLET</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Theme Toggle Button at FAR RIGHT */}
          <button
            type="button"
            onClick={toggleTheme}
            className="w-8 h-8 rounded-full border border-(--border)/80 hover:border-(--text-primary) hover:shadow-[0_0_10px_rgba(255,255,255,0.15)] bg-(--surface)/70 backdrop-blur-md flex items-center justify-center text-xs font-mono transition-all duration-200 hover:scale-105 shrink-0"
            aria-label="Toggle theme"
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>

          {/* Mobile Menu Toggle */}
          <button
            type="button"
            onClick={() => setMobileOpen(!mobileOpen)}
            className="lg:hidden p-2 text-(--text-primary) border border-(--border) rounded-full hover:bg-(--surface)"
            aria-label="Toggle menu"
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Full-screen Mobile Drawer Menu (Optimus style) */}
      <div
        className={`lg:hidden fixed inset-0 bg-(--bg) z-40 transition-all duration-500 ${
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        style={{ top: "100px" }}
      >
        <div className="flex flex-col h-[calc(100vh-100px)] px-8 pt-6 pb-12 overflow-y-auto">
          <div className="flex items-center gap-3 pb-5 mb-3 border-b border-(--border)/60">
            <Image
              src="/pramaan-icon.png"
              alt="PRAMAAN Emblem"
              width={32}
              height={32}
              className="w-8 h-8 object-contain"
            />
            <span className="font-pramaan font-bold tracking-wider text-lg text-(--text-primary)">
              PRAMAAN
            </span>
            <button
              type="button"
              onClick={toggleTheme}
              className="ml-auto font-mono text-[11px] text-(--text-muted) px-2.5 py-1 rounded border border-(--border) hover:text-(--text-primary) flex items-center gap-1.5 transition-colors"
            >
              <span>{theme === "dark" ? "☀ LIGHT" : "☾ DARK"}</span>
            </button>
          </div>

          <div className="flex-1 flex flex-col justify-center gap-6">
            {links.map((l, idx) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setMobileOpen(false)}
                className={`text-4xl font-display text-(--text-primary) hover:text-(--text-muted) transition-all duration-500 ${
                  mobileOpen ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
                }`}
                style={{ transitionDelay: mobileOpen ? `${60 * idx}ms` : "0ms" }}
              >
                <span className="font-mono text-sm text-(--text-faint) mr-3">{l.tag}</span>
                {l.label}
              </Link>
            ))}
          </div>

          <div
            className={`pt-8 border-t border-(--border) flex flex-col gap-4 transition-all duration-500 ${
              mobileOpen ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
            style={{ transitionDelay: mobileOpen ? "400ms" : "0ms" }}
          >
            {token && claims ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-(--text-muted)">
                    {address?.slice(0, 6)}...{address?.slice(-4)} ({claims.role})
                  </span>
                  {secondsRemaining !== null && (
                    <span className="text-xs font-mono text-cyan-400">
                      ⏱ {formatCountdown(secondsRemaining)}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    setMobileOpen(false);
                  }}
                  className="w-full py-2.5 text-xs font-mono text-rose-400 border border-rose-500/40 rounded-full hover:bg-rose-500/10 tracking-wider"
                >
                  DISCONNECT
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  loginWithWallet();
                  setMobileOpen(false);
                }}
                className="w-full py-4 rounded-full bg-(--text-primary) text-(--bg) font-mono text-xs font-semibold tracking-wider"
              >
                CONNECT WALLET (EIP-712)
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
