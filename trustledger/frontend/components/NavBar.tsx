"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/AuthContext";
import { useTheme } from "@/lib/ThemeContext";
import { Badge, Spinner } from "@/components/ui";
import { Menu, X, ArrowRight } from "@/components/Icons";
import { useEffect, useState } from "react";

const links = [
  { href: "/", label: "Home", tag: "00" },
  { href: "/identities", label: "Identities", tag: "01" },
  { href: "/assets", label: "Assets", tag: "02" },
  { href: "/permissions", label: "Permissions", tag: "03" },
  { href: "/download", label: "Download", tag: "04" },
  { href: "/policy-check", label: "Policy-at-Time", tag: "05" },
  { href: "/verify", label: "Verify Bundle", tag: "06" },
];

export function NavBar() {
  const pathname = usePathname();
  const { address, did, claims, token, loading, error, loginWithWallet, logout } =
    useAuth();
  const { theme, toggleTheme } = useTheme();
  const [timeStr, setTimeStr] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    function updateClock() {
      const now = new Date();
      setTimeStr(now.toUTCString().slice(17, 25) + " UTC");
    }
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="sticky top-0 z-50 border-b border-(--border) bg-(--bg)/90 backdrop-blur-md transition-colors duration-300">
      {/* Top Telemetry Ticker Bar */}
      <div className="border-b border-(--border)/60 px-4 sm:px-8 h-7 flex items-center justify-between text-[11px] font-mono tracking-widest text-(--text-muted) bg-(--surface)/40">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-(--success) animate-pulse" />
            <span className="text-(--text-primary) font-semibold">ALL_SYSTEMS_OPERATIONAL</span>
          </span>
          <span className="hidden md:inline text-(--border)">|</span>
          <span className="hidden md:inline">HARDHAT_NETWORK: 31337</span>
          <span className="hidden lg:inline text-(--border)">|</span>
          <span className="hidden lg:inline">SIH PROTOCOL ENGINE 26125</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="tabular-nums text-(--text-muted)">{timeStr || "SYSTEM ACTIVE"}</span>
          <span className="text-(--border)">|</span>
          <span className="font-mono text-xs text-(--text-primary)">v1.0.4</span>
        </div>
      </div>

      {/* Main Navigation Bar */}
      <div className="mx-auto max-w-[1400px] px-6 lg:px-8 h-18 flex items-center justify-between gap-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-baseline gap-1.5 group">
            <span className="font-display tracking-tight text-2xl lg:text-3xl text-(--text-primary) group-hover:opacity-80 transition-opacity">
              PRAMAAN
            </span>
            <span className="text-(--text-muted) font-mono text-[11px] tracking-widest">
              TM
            </span>
          </Link>

          <nav className="hidden lg:flex items-center gap-6 text-sm">
            {links.map((l) => {
              const isActive = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`nav-link py-1 text-xs font-mono tracking-wider transition-colors duration-200 ${
                    isActive
                      ? "active text-(--text-primary) font-semibold"
                      : "text-(--text-muted) hover:text-(--text-primary)"
                  }`}
                >
                  <span className="text-(--text-faint) mr-1 text-[10px]">{l.tag}.</span>
                  {l.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          {/* Theme Toggle Button */}
          <button
            type="button"
            onClick={toggleTheme}
            className="w-9 h-9 rounded-full border border-(--border) hover:border-(--text-primary) bg-(--surface) flex items-center justify-center text-xs font-mono transition-all hover:scale-105"
            aria-label="Toggle theme"
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>

          {/* Auth State Button */}
          <div className="hidden sm:flex items-center">
            {loading ? (
              <div className="inline-flex items-center gap-2 rounded-full border border-(--border) px-4 py-2 text-xs font-mono text-(--text-muted)">
                <Spinner />
                <span>CONNECTING...</span>
              </div>
            ) : token && claims ? (
              <div className="flex items-center gap-2">
                <span className="hidden xl:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-(--border) bg-(--surface) text-[11px] font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-(--success) animate-pulse" />
                  <span className="text-(--text-muted)">
                    {address?.slice(0, 6)}...{address?.slice(-4)}
                  </span>
                  <span className="text-(--border)">/</span>
                  <span className="text-(--text-primary) font-bold">{claims.role}</span>
                </span>
                <button
                  type="button"
                  onClick={logout}
                  className="rounded-full border border-(--border) hover:border-(--danger) hover:text-(--danger) bg-(--surface) px-4 py-2 text-xs font-mono transition-colors"
                >
                  DISCONNECT
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={loginWithWallet}
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-xs font-mono font-medium bg-(--text-primary) hover:opacity-90 text-(--bg) rounded-full px-5 py-2.5 transition-all duration-300 hover:scale-[1.02] shadow-sm"
              >
                <span>CONNECT WALLET</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

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
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-(--text-muted)">
                  {address?.slice(0, 6)}...{address?.slice(-4)} ({claims.role})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    setMobileOpen(false);
                  }}
                  className="px-4 py-2 text-xs font-mono text-(--danger) border border-(--danger)/40 rounded-full"
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
