"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/lib/AuthContext";
import { Card, Badge } from "@/components/ui";
import { AsciiSphere } from "@/components/AsciiSphere";
import { AsciiCryptoCube } from "@/components/AsciiCryptoCube";
import { AsciiWaveField } from "@/components/AsciiWaveField";
import {
  ArrowRight,
  ArrowUpRight,
  ShieldCheck,
  Lock,
  Key,
  Eye,
  FileCheck,
  Check,
  Copy,
  Clock,
  Activity,
  Cpu,
  Layers,
  Database,
} from "@/components/Icons";

// Animated counter hook with cubic ease-out
function CountUp({ end, suffix = "", prefix = "" }: { end: number; suffix?: string; prefix?: string }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started) {
          setStarted(true);
          const startTime = performance.now();
          const duration = 1800;

          const tick = (now: number) => {
            const progress = Math.min((now - startTime) / duration, 1);
            // Cubic ease-out: 1 - (1 - p)^3
            const eased = 1 - Math.pow(1 - progress, 3);
            setVal(Math.floor(eased * end));

            if (progress < 1) {
              requestAnimationFrame(tick);
            }
          };
          requestAnimationFrame(tick);
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [end, started]);

  return (
    <div ref={ref} className="text-5xl lg:text-7xl font-display tracking-tight text-(--text-primary)">
      {prefix}
      {val.toLocaleString()}
      {suffix}
    </div>
  );
}

// 7-Step Operational Sequence
const lifecycleSteps = [
  {
    num: "01",
    tag: "REGISTRY",
    href: "/identities",
    title: "Register Identities",
    desc: "Admin registers Manager, Auditor, and User identities on-chain in IdentityRegistry.sol. Metadata is pinned in PostgreSQL.",
    code: `// IdentityRegistry.sol
function registerIdentity(
  address subject,
  string calldata did,
  Role role
) external onlyAdmin {
  identities[subject] = Identity(did, role, true);
  emit IdentityRegistered(subject, did, role);
}`,
  },
  {
    num: "02",
    tag: "VAULT",
    href: "/assets",
    title: "Register Encrypted Asset",
    desc: "Backend calculates document SHA-256 digest, encrypts off-chain with AES-256-GCM, and pins root hash in AssetRegistry.sol.",
    code: `// AssetRegistry.sol
function registerAsset(
  bytes32 assetId,
  bytes32 contentHash,
  string calldata ipfsUri
) external onlyRole(MANAGER_ROLE) {
  assets[assetId] = Asset(contentHash, block.timestamp);
  emit AssetRegistered(assetId, contentHash);
}`,
  },
  {
    num: "03",
    tag: "POLICY",
    href: "/permissions",
    title: "Grant Access Policy",
    desc: "Admin or Manager grants READ access to a subject DID. Recorded in AccessControl.sol with immutable validity timestamps.",
    code: `// AccessControl.sol
function grantAccess(
  bytes32 assetId,
  address subject,
  uint256 validUntil
) external onlyAuthorized {
  policies[assetId][subject] = Policy({
    validFrom: block.timestamp,
    validUntil: validUntil,
    active: true
  });
}`,
  },
  {
    num: "04",
    tag: "DISPATCH",
    href: "/download",
    title: "Download as Granted Subject",
    desc: "Subject requests file. Backend verifies on-chain policy, logs an AssetAccessed event, and emits cryptographic X-Proof-Bundle.",
    code: `// ProofBundle.json
{
  "assetId": "0x7f4a...9b12",
  "subjectDid": "did:pramaan:0xf3...2266",
  "policyVersion": 3,
  "accessedAt": 1727048123,
  "signerSignature": "0x4b7c8...91a2"
}`,
  },
  {
    num: "05",
    tag: "REVOCATION",
    href: "/permissions",
    title: "Revoke Access Policy",
    desc: "Revoke subject permission on-chain. Zero-overwrite immutable history records a new policy revision with updated bounds.",
    code: `// AccessControl.sol
function revokeAccess(
  bytes32 assetId,
  address subject
) external onlyAuthorized {
  policies[assetId][subject].active = false;
  policies[assetId][subject].revokedAt = block.timestamp;
  emit PolicyRevoked(assetId, subject, block.timestamp);
}`,
  },
  {
    num: "06",
    tag: "TEMPORAL",
    href: "/policy-check",
    title: "Policy-at-the-Time Query",
    desc: "SIH core innovation: prove whether access was legitimate at an exact historical timestamp before or after policy changes.",
    code: `// Temporal Auditor Query
const isLegitimate = await pramaan.verifyPolicyAtTime({
  assetId: "0x7f4a...9b12",
  subject: "0xf39Fd6...2266",
  timestamp: 1727047000 // T-delta audit
}); // returns: true (Authorized)`,
  },
  {
    num: "07",
    tag: "AUDIT",
    href: "/verify",
    title: "Independent Proof Verifier",
    desc: "Public verifiability: paste any proof bundle without login. Re-verifies signature against backend key and confirms on-chain state.",
    code: `// Independent Public Verifier
const verified = verifyProofSignature(bundle);
const onChainFact = await contract.verifyFact(
  bundle.assetId,
  bundle.contentHash
); // 100% Cryptographic Match`,
  },
];

// Developer SDK snippets
const devSnippets = [
  {
    label: "Ethers / Node SDK",
    code: `import { PRAMAAN } from '@pramaan/sdk';

const client = new PRAMAAN({
  rpcUrl: 'http://127.0.0.1:8545',
  contractAddress: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
  privateKey: process.env.PRIVATE_KEY
});

// Register on-chain verifiable document
const asset = await client.registerAsset({
  filePath: './contract-v1.pdf',
  accessRules: [{ did: 'did:pramaan:0xf3...', permission: 'READ' }]
});`,
  },
  {
    label: "REST API Endpoint",
    code: `curl -X POST https://api.pramaan.network/v1/assets/register \\
  -H "Authorization: Bearer \${EIP712_JWT_TOKEN}" \\
  -H "Content-Type: multipart/form-data" \\
  -F "document=@confidential_report.pdf" \\
  -F "policyValidUntil=1758585600"`,
  },
  {
    label: "CLI Proof Verifier",
    code: `# Verify proof bundle independently without server login
npx @pramaan/cli verify-proof \\
  --bundle ./proof-bundle.json \\
  --rpc http://127.0.0.1:8545 \\
  --strict

# Output: [PASS] Signature valid · [PASS] On-chain state matches`,
  },
];

// Rotating Hero Verbs
const rotatingVerbs = ["VERIFY", "PROTECT", "AUDIT", "ENFORCE"];

// Tech Stack Showcase Data & Crisp Vector Logos
const techStackItems = [
  {
    name: "Solidity",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8 sm:w-9 sm:h-9 shrink-0" fill="none">
        <path d="M18.55 4.23L12 0 5.45 4.23 12 8.46l6.55-4.23z" fill="#627EEA" />
        <path d="M5.45 4.23v7.46L12 15.92V8.46L5.45 4.23z" fill="#4E67C8" />
        <path d="M18.55 4.23v7.46L12 15.92V8.46l6.55-4.23z" fill="#7B93F5" />
        <path d="M12 15.92l-6.55-4.23 6.55 12.31 6.55-12.31-6.55 4.23z" fill="#627EEA" />
      </svg>
    ),
  },
  {
    name: "Hardhat",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8 sm:w-9 sm:h-9 shrink-0" fill="none">
        <rect width="24" height="24" rx="6" fill="#FFF100" fillOpacity="0.25" />
        <path d="M12 3L4 7.5v9L12 21l8-4.5v-9L12 3z" stroke="#F5A623" strokeWidth="1.6" />
        <path d="M12 3v18M4 7.5l8 4.5 8-4.5" stroke="#F5A623" strokeWidth="1.3" />
      </svg>
    ),
  },
  {
    name: "Next.js",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8 sm:w-9 sm:h-9 shrink-0 fill-current">
        <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.834 17.514L9.75 6.96h-1.5v10.08h1.44v-7.854l7.07 9.535a9.638 9.638 0 001.074-1.207zm-2.034-4.814l1.44 1.944V6.96h-1.44v5.74z" />
      </svg>
    ),
  },
  {
    name: "TypeScript",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8 sm:w-9 sm:h-9 shrink-0" fill="none">
        <rect width="24" height="24" rx="5" fill="#3178C6" />
        <path d="M11.5 8H6v1.5h2v6.5h1.5V9.5h2V8zm4 3.5c-.8 0-1.5.3-1.8.7l1 1c.2-.2.5-.3.8-.3.4 0 .7.2.7.5 0 .2-.2.4-.6.5l-.8.3c-1.1.4-1.6 1.1-1.6 2 0 1.2 1 2 2.3 2 1 0 1.8-.4 2.2-1l-1-1c-.3.3-.7.5-1.2.5-.5 0-.8-.2-.8-.6 0-.3.2-.5.7-.6l.8-.3c1.2-.4 1.7-1.1 1.7-2 0-1.3-1-2-2.3-2z" fill="#FFFFFF" />
      </svg>
    ),
  },
  {
    name: "PostgreSQL",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8 sm:w-9 sm:h-9 shrink-0" fill="#336791">
        <path d="M12.062 1.986c-5.523 0-10 4.477-10 10 0 5.522 4.477 10 10 10 5.522 0 10-4.478 10-10 0-5.523-4.478-10-10-10zm.014 2.827c1.378 0 2.502.404 3.373 1.212.871.808 1.307 1.91 1.307 3.307v5.719h-2.133v-1.321c-.604.996-1.55 1.494-2.838 1.494-1.124 0-2.036-.342-2.736-1.026-.7-.684-1.05-1.583-1.05-2.697 0-1.189.39-2.128 1.171-2.817.781-.689 1.836-1.033 3.165-1.033.784 0 1.479.13 2.084.391v-.218c0-.858-.239-1.517-.717-1.977-.478-.46-1.174-.69-2.088-.69-.972 0-1.895.234-2.768.702l-.768-1.597c1.116-.628 2.378-.942 3.788-.942zm.28 7.378c-.767 0-1.373.197-1.819.591-.446.394-.669.932-.669 1.614 0 .641.206 1.155.618 1.543.412.388.971.582 1.677.582.767 0 1.391-.258 1.872-.774.481-.516.721-1.204.721-2.064v-.695c-.655-.531-1.455-.797-2.4-.797z" />
      </svg>
    ),
  },
  {
    name: "OpenZeppelin",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8 sm:w-9 sm:h-9 shrink-0" fill="none">
        <rect width="24" height="24" rx="6" fill="#4E5EE4" />
        <path d="M12 4.5l6.5 2.5v5.5c0 4.2-2.8 8.1-6.5 9.5-3.7-1.4-6.5-5.3-6.5-9.5V7L12 4.5z" fill="#FFFFFF" />
        <path d="M12 6.3L7 8.2v4.2c0 3.3 2.1 6.3 5 7.4V6.3z" fill="#4E5EE4" />
      </svg>
    ),
  },
  {
    name: "Prisma",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8 sm:w-9 sm:h-9 shrink-0" fill="none">
        <path d="M12.784 1.77a1 1 0 00-1.568 0L2.34 13.91a1 1 0 00.323 1.5l14.16 8.176a1 1 0 001.442-.647l4.38-19.14a1 1 0 00-1.282-1.183l-8.579 2.155z" fill="#2D3748" fillOpacity="0.4" />
        <path d="M12 2.5l8.5 2.1-4.3 18.8L12 2.5z" fill="#16A394" />
        <path d="M12 2.5L2.8 14.5l13.4 8.9L12 2.5z" fill="#2D3748" />
      </svg>
    ),
  },
  {
    name: "Docker",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8 sm:w-9 sm:h-9 shrink-0" fill="#2496ED">
        <rect x="2" y="9" width="3" height="2.5" rx="0.5" fill="#2496ED" />
        <rect x="6" y="9" width="3" height="2.5" rx="0.5" fill="#2496ED" />
        <rect x="10" y="9" width="3" height="2.5" rx="0.5" fill="#2496ED" />
        <rect x="6" y="6" width="3" height="2.5" rx="0.5" fill="#2496ED" />
        <rect x="10" y="6" width="3" height="2.5" rx="0.5" fill="#2496ED" />
        <rect x="10" y="3" width="3" height="2.5" rx="0.5" fill="#2496ED" />
        <path d="M1.5 12.5C1 14 2 17 6 18.5c5 2 12 1.5 15-1.5 1.5-1.5 1.5-3 1.5-3s-1.5.5-3 0c-.5-.2-1.5-.8-1.5-1.5 0 0-2 0-3 1.5-2 0-4-1-5-1.5H1.5z" fill="#2496ED" />
      </svg>
    ),
  },
  {
    name: "React",
    icon: (
      <svg viewBox="-11.5 -10.23174 23 20.46348" className="w-8 h-8 sm:w-9 sm:h-9 shrink-0">
        <circle cx="0" cy="0" r="2.05" fill="#61DAFB" />
        <g stroke="#61DAFB" strokeWidth="1" fill="none">
          <ellipse rx="11" ry="4.2" />
          <ellipse rx="11" ry="4.2" transform="rotate(60)" />
          <ellipse rx="11" ry="4.2" transform="rotate(120)" />
        </g>
      </svg>
    ),
  },
  {
    name: "Tailwind CSS",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8 sm:w-9 sm:h-9 shrink-0" fill="#06B6D4">
        <path d="M12.001 4.8c-3.2 0-5.2 1.6-6 4.8 1.2-1.6 2.6-2.2 4.2-1.8.913.228 1.565.89 2.288 1.624C13.666 10.618 15.027 12 18.001 12c3.2 0 5.2-1.6 6-4.8-1.2 1.6-2.6 2.2-4.2 1.8-.913-.228-1.565-.89-2.288-1.624C16.337 6.182 14.975 4.8 12.001 4.8zm-6 7.2c-3.2 0-5.2 1.6-6 4.8 1.2-1.6 2.6-2.2 4.2-1.8.913.228 1.565.89 2.288 1.624C13.666 17.818 15.027 19.2 18.001 19.2c3.2 0 5.2-1.6 6-4.8-1.2 1.6-2.6 2.2-4.2 1.8-.913-.228-1.565-.89-2.288-1.624C10.337 13.382 8.975 12 6.001 12z" />
      </svg>
    ),
  },
  {
    name: "Ethers.js",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8 sm:w-9 sm:h-9 shrink-0" fill="none">
        <circle cx="12" cy="12" r="10.5" fill="#2535A0" />
        <path d="M6.5 8h11M8.5 12h7M6.5 16h11" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    name: "Express.js",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8 sm:w-9 sm:h-9 shrink-0" fill="none">
        <rect width="24" height="24" rx="6" fill="#68A063" fillOpacity="0.2" />
        <path d="M12 3.5l7 4v8.5l-7 4-7-4V7.5l7-4z" stroke="#68A063" strokeWidth="1.6" />
        <path d="M12 8.5v7M8.5 10.5l7 3M8.5 13.5l7-3" stroke="#68A063" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    name: "EIP-712 Auth",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8 sm:w-9 sm:h-9 shrink-0" fill="none">
        <rect width="24" height="24" rx="6" fill="#F6851B" fillOpacity="0.2" />
        <path d="M12 3l7 4v6.5c0 4.5-3 8.5-7 9.8-4-1.3-7-5.3-7-9.8V7l7-4z" stroke="#F6851B" strokeWidth="1.6" />
        <path d="M9.5 12l2 2 3.5-3.5" stroke="#F6851B" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    name: "AES-256-GCM",
    icon: (
      <svg viewBox="0 0 24 24" className="w-8 h-8 sm:w-9 sm:h-9 shrink-0" fill="none">
        <rect width="24" height="24" rx="6" fill="#10B981" fillOpacity="0.2" />
        <rect x="5.5" y="10.5" width="13" height="9" rx="2" stroke="#10B981" strokeWidth="1.6" />
        <path d="M8.5 10.5V7a3.5 3.5 0 017 0v3.5" stroke="#10B981" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="12" cy="15" r="1.2" fill="#10B981" />
      </svg>
    ),
  },
];

export default function Home() {
  const { address, did, token, claims } = useAuth();

  // Verb rotator
  const [verbIdx, setVerbIdx] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setVerbIdx((prev) => (prev + 1) % rotatingVerbs.length);
    }, 2800);
    return () => clearInterval(timer);
  }, []);

  // Operational Lifecycle auto-cycle
  const [activeStep, setActiveStep] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % lifecycleSteps.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Developer SDK tab & copy
  const [devTab, setDevTab] = useState(0);
  const [copied, setCopied] = useState(false);

  // Mouse spotlight coordinates
  const [spotlight, setSpotlight] = useState({ x: 50, y: 50 });

  // Clock for telemetry (IST 24-hr format)
  const [clock, setClock] = useState("");
  useEffect(() => {
    const update = () => {
      const now = new Date();
      const istTime = now.toLocaleTimeString("en-GB", {
        timeZone: "Asia/Kolkata",
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      setClock(`${istTime} IST`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  // Consensus node latency simulation
  const [activeNodeIdx, setActiveNodeIdx] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setActiveNodeIdx((prev) => (prev + 1) % 5);
    }, 2200);
    return () => clearInterval(timer);
  }, []);

  const consensusNodes = [
    { name: "Hardhat Local EVM", region: "Localhost:8545", chainId: "31337", latency: "1ms" },
    { name: "Sepolia Testnet", region: "Ethereum PoS", chainId: "11155111", latency: "38ms" },
    { name: "Arbitrum One Node", region: "L2 Rollup", chainId: "42161", latency: "16ms" },
    { name: "Polygon zkEVM", region: "Zero-Knowledge", chainId: "1101", latency: "22ms" },
    { name: "Ethereum Mainnet", region: "Decentralized L1", chainId: "1", latency: "88ms" },
  ];

  return (
    <div className="flex flex-col min-h-screen">
      {/* =========================================================================
          SECTION 1: HERO COMMAND CENTER (Optimus Editorial Style)
      ========================================================================= */}
      <section className="relative min-h-[90vh] flex flex-col justify-center overflow-hidden border-b border-(--border)">
        {/* Background 3D ASCII Sphere */}
        <div className="absolute right-0 top-1/2 -translate-y-1/2 w-125 h-125 lg:w-187.5 lg:h-187.5 opacity-35 pointer-events-none">
          <AsciiSphere />
        </div>

        {/* Architectural drafting grid lines */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20" aria-hidden="true">
          {[...Array(8)].map((_, i) => (
            <div
              key={`h-${i}`}
              className="absolute h-px bg-(--text-primary)/10 left-0 right-0"
              style={{ top: `${12.5 * (i + 1)}%` }}
            />
          ))}
          {[...Array(12)].map((_, i) => (
            <div
              key={`v-${i}`}
              className="absolute w-px bg-(--text-primary)/10 top-0 bottom-0"
              style={{ left: `${8.33 * (i + 1)}%` }}
            />
          ))}
        </div>

        {/* Hero Content */}
        <div className="relative z-10 max-w-350 mx-auto px-6 lg:px-12 py-24 lg:py-32">
          {/* Subtitle / System Kicker */}
          <div className="mb-8">
            <span className="inline-flex items-center gap-3 text-xs sm:text-sm font-mono text-(--text-muted)">
              <span className="w-8 h-px bg-(--text-primary)/30" />
              SIH 2026 // PS 26125 CONSENSUS PROTOCOL ENGINE
            </span>
          </div>

          {/* Main Display Headline */}
          <div className="mb-10 max-w-5xl">
            <h1 className="text-[clamp(2.75rem,8vw,7.5rem)] font-display leading-[0.95] tracking-tight text-(--text-primary)">
              <span className="block">Tamper-evident</span>
              <span className="block">
                document security to{" "}
                <span className="relative inline-block">
                  <span className="inline-flex">
                    {rotatingVerbs[verbIdx].split("").map((char, cIdx) => (
                      <span
                        key={`${verbIdx}-${cIdx}`}
                        className="inline-block animate-char-in"
                        style={{ animationDelay: `${40 * cIdx}ms` }}
                      >
                        {char}
                      </span>
                    ))}
                  </span>
                  <span className="absolute -bottom-2 left-0 right-0 h-2.5 bg-(--text-primary)/10" />
                </span>
              </span>
            </h1>
          </div>

          {/* Subtitle & Actions Grid */}
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-24 items-end">
            <p className="text-lg lg:text-2xl text-(--text-muted) leading-relaxed max-w-xl font-normal">
              Autonomous, zero-trust infrastructure. Enforces on-chain access policies, generates verifiable proof bundles, and enables cryptographic temporal audits at block speed.
            </p>

            <div className="flex flex-col sm:flex-row items-start gap-4">
              <a
                href="#demo-sequence"
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-mono font-medium bg-(--text-primary) hover:opacity-90 text-(--bg) px-8 h-14 rounded-full group transition-all duration-300 hover:scale-[1.02] shadow-sm"
              >
                <span>Launch Interactive Demo</span>
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </a>

              <Link
                href="/verify"
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-mono font-medium border border-(--border) hover:border-(--text-primary) bg-(--surface) hover:bg-(--surface-hover) text-(--text-primary) px-8 h-14 rounded-full transition-all duration-300 hover:scale-[1.02]"
              >
                <span>Verify Proof Bundle</span>
                <ArrowUpRight className="w-4 h-4 opacity-70" />
              </Link>
            </div>
          </div>
        </div>

        {/* =========================================================================
            TECH STACK SHOWCASE: DOUBLE-BUFFERED INFINITE MARQUEE (FULLY TRANSPARENT)
        ========================================================================= */}
        <div className="mt-auto overflow-hidden py-8 sm:py-10 bg-transparent">
          <div className="marquee gap-10 sm:gap-14 font-mono tracking-normal bg-transparent">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex gap-10 sm:gap-14 shrink-0 items-center bg-transparent">
                {techStackItems.map((tech, idx) => (
                  <div
                    key={`${copy}-${idx}`}
                    className="inline-flex items-center gap-3.5 sm:gap-4 shrink-0 cursor-default group"
                  >
                    <span className="w-8 h-8 sm:w-9 sm:h-9 flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110">
                      {tech.icon}
                    </span>
                    <span className="font-sans font-semibold text-base sm:text-lg text-(--text-primary) tracking-tight whitespace-nowrap">
                      {tech.name}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 2: CAPABILITIES (Optimus Features Style)
      ========================================================================= */}
      <section id="features" className="relative py-24 lg:py-32 border-b border-(--border)">
        <div className="max-w-350 mx-auto px-6 lg:px-12">
          <div className="mb-16 lg:mb-24">
            <span className="inline-flex items-center gap-3 text-xs sm:text-sm font-mono text-(--text-muted) mb-6">
              <span className="w-8 h-px bg-(--text-primary)/30" />
              Capabilities // CORE_PILLARS
            </span>
            <h2 className="text-4xl lg:text-6xl font-display tracking-tight text-(--text-primary)">
              Everything you need.
              <br />
              <span className="text-(--text-muted)">Nothing you don&apos;t.</span>
            </h2>
          </div>

          <div className="divide-y divide-(--border)">
            {/* 01 */}
            <div className="group py-12 lg:py-16 grid lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-1">
                <span className="font-mono text-sm text-(--text-muted)">01</span>
              </div>
              <div className="lg:col-span-6">
                <h3 className="text-3xl lg:text-4xl font-display text-(--text-primary) mb-3 group-hover:translate-x-1.5 transition-transform duration-300">
                  On-Chain Identity Registry
                </h3>
                <p className="text-base lg:text-lg text-(--text-muted) leading-relaxed">
                  Decentralized identity mapping with OpenZeppelin role-based controls. Bind cryptographic wallet addresses to enterprise DIDs (Admin, Manager, Auditor, User).
                </p>
              </div>
              <div className="lg:col-span-5 flex justify-start lg:justify-end">
                <div className="p-4 rounded-xl border border-(--border) bg-(--surface) flex items-center gap-4 text-xs font-mono">
                  <div className="w-10 h-10 rounded-full border border-(--border) flex items-center justify-center bg-(--bg)">
                    <Key className="w-5 h-5 text-(--text-primary)" />
                  </div>
                  <div>
                    <span className="text-(--text-muted) block">ROLE ENFORCEMENT</span>
                    <span className="text-(--text-primary) font-semibold">IdentityRegistry.sol</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 02 */}
            <div className="group py-12 lg:py-16 grid lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-1">
                <span className="font-mono text-sm text-(--text-muted)">02</span>
              </div>
              <div className="lg:col-span-6">
                <h3 className="text-3xl lg:text-4xl font-display text-(--text-primary) mb-3 group-hover:translate-x-1.5 transition-transform duration-300">
                  Off-Chain AES-256-GCM Vault
                </h3>
                <p className="text-base lg:text-lg text-(--text-muted) leading-relaxed">
                  Sensitive documents never hit public blockchains in plaintext. High-throughput files are encrypted off-chain while SHA-256 hash commitments live on Ethereum.
                </p>
              </div>
              <div className="lg:col-span-5 flex justify-start lg:justify-end">
                <div className="p-4 rounded-xl border border-(--border) bg-(--surface) flex items-center gap-4 text-xs font-mono">
                  <div className="w-10 h-10 rounded-full border border-(--border) flex items-center justify-center bg-(--bg)">
                    <Lock className="w-5 h-5 text-(--text-primary)" />
                  </div>
                  <div>
                    <span className="text-(--text-muted) block">ENCRYPTED AT REST</span>
                    <span className="text-(--text-primary) font-semibold">AssetRegistry.sol</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 03 */}
            <div className="group py-12 lg:py-16 grid lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-1">
                <span className="font-mono text-sm text-(--text-muted)">03</span>
              </div>
              <div className="lg:col-span-6">
                <h3 className="text-3xl lg:text-4xl font-display text-(--text-primary) mb-3 group-hover:translate-x-1.5 transition-transform duration-300">
                  Temporal Historical Reasoning
                </h3>
                <p className="text-base lg:text-lg text-(--text-muted) leading-relaxed">
                  The SIH core innovation. Query whether an actor was legitimately authorized at an exact past timestamp (T-delta). Compare state before vs. after revocation.
                </p>
              </div>
              <div className="lg:col-span-5 flex justify-start lg:justify-end">
                <div className="p-4 rounded-xl border border-(--border) bg-(--surface) flex items-center gap-4 text-xs font-mono">
                  <div className="w-10 h-10 rounded-full border border-(--border) flex items-center justify-center bg-(--bg)">
                    <Clock className="w-5 h-5 text-(--text-primary)" />
                  </div>
                  <div>
                    <span className="text-(--text-muted) block">TEMPORAL AUDITS</span>
                    <span className="text-(--text-primary) font-semibold">AccessControl.sol</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 04 */}
            <div className="group py-12 lg:py-16 grid lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-1">
                <span className="font-mono text-sm text-(--text-muted)">04</span>
              </div>
              <div className="lg:col-span-6">
                <h3 className="text-3xl lg:text-4xl font-display text-(--text-primary) mb-3 group-hover:translate-x-1.5 transition-transform duration-300">
                  Independent Proof Verifier
                </h3>
                <p className="text-base lg:text-lg text-(--text-muted) leading-relaxed">
                  Third-party auditors can verify proof bundles offline or online without an account. Re-validates ECDSA digital signatures and confirms block truth.
                </p>
              </div>
              <div className="lg:col-span-5 flex justify-start lg:justify-end">
                <div className="p-4 rounded-xl border border-(--border) bg-(--surface) flex items-center gap-4 text-xs font-mono">
                  <div className="w-10 h-10 rounded-full border border-(--border) flex items-center justify-center bg-(--bg)">
                    <ShieldCheck className="w-5 h-5 text-(--text-primary)" />
                  </div>
                  <div>
                    <span className="text-(--text-muted) block">PUBLIC AUDITABILITY</span>
                    <span className="text-(--text-primary) font-semibold">X-Proof-Bundle</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 3: LIVE METRICS & SESSION HUD (Optimus Live Metrics Style)
      ========================================================================= */}
      <section id="metrics" className="relative py-24 lg:py-32 border-b border-(--border)">
        <div className="max-w-350 mx-auto px-6 lg:px-12">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8 mb-16 lg:mb-24">
            <div>
              <span className="inline-flex items-center gap-3 text-xs sm:text-sm font-mono text-(--text-muted) mb-6">
                <span className="w-8 h-px bg-(--text-primary)/30" />
                Live Telemetry // PROTOCOL_STATE
              </span>
              <h2 className="text-4xl lg:text-6xl font-display tracking-tight text-(--text-primary)">
                Performance you
                <br />
                can measure.
              </h2>
            </div>
            <div className="flex items-center gap-4 font-mono text-xs sm:text-sm text-(--text-muted)">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-(--success) animate-pulse" />
                Live Node
              </span>
              <span className="text-(--border)">|</span>
              <span className="tabular-nums">{clock || "INITIALIZING..."}</span>
            </div>
          </div>

          {/* 4 Polynomial Counter Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-(--border) mb-12">
            <div className="bg-(--bg) p-8 lg:p-12">
              <CountUp end={100} suffix="%" />
              <div className="mt-4 text-base lg:text-lg text-(--text-muted)">
                On-chain immutable audit trail
              </div>
            </div>

            <div className="bg-(--bg) p-8 lg:p-12">
              <CountUp end={31337} prefix="#" />
              <div className="mt-4 text-base lg:text-lg text-(--text-muted)">
                Consensus EVM Chain ID
              </div>
            </div>

            <div className="bg-(--bg) p-8 lg:p-12">
              <CountUp end={20} prefix="< " suffix="ms" />
              <div className="mt-4 text-base lg:text-lg text-(--text-muted)">
                Average proof verification time
              </div>
            </div>

            <div className="bg-(--bg) p-8 lg:p-12">
              <CountUp end={256} suffix="-bit" />
              <div className="mt-4 text-base lg:text-lg text-(--text-muted)">
                AES-GCM cryptographic vault strength
              </div>
            </div>
          </div>

          {/* Active Session HUD Card */}
          <div className="p-8 lg:p-10 border border-(--border) rounded-2xl bg-(--surface)">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-(--border)">
              <div className="flex items-center gap-3">
                <span className="w-2.5 h-2.5 rounded-full bg-(--success) animate-pulse" />
                <span className="font-mono text-sm font-semibold text-(--text-primary) uppercase tracking-wider">
                  Active Session Telemetry
                </span>
              </div>
              <Badge tone={token && claims ? "green" : "neutral"}>
                {token && claims ? "AUTHENTICATED_SESSION" : "NO_ACTIVE_SESSION"}
              </Badge>
            </div>

            <div className="pt-6">
              {token && claims ? (
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 text-xs font-mono">
                  <div>
                    <span className="text-(--text-muted) block mb-1.5">SIGNER_ADDRESS:</span>
                    <span className="text-(--text-primary) bg-(--bg) px-3 py-2 rounded-lg border border-(--border) block truncate">
                      {address}
                    </span>
                  </div>
                  <div>
                    <span className="text-(--text-muted) block mb-1.5">DECENTRALIZED_ID:</span>
                    <span className="text-(--text-primary) bg-(--bg) px-3 py-2 rounded-lg border border-(--border) block truncate">
                      {did}
                    </span>
                  </div>
                  <div>
                    <span className="text-(--text-muted) block mb-1.5">SESSION_ROLE:</span>
                    <span className="text-(--success) font-bold bg-(--bg) px-3 py-2 rounded-lg border border-(--border) block">
                      {claims.role}
                    </span>
                  </div>
                  <div>
                    <span className="text-(--text-muted) block mb-1.5">SESSION_EXPIRY:</span>
                    <span className="text-(--text-primary) bg-(--bg) px-3 py-2 rounded-lg border border-(--border) block">
                      {new Date(claims.exp * 1000).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 py-2">
                  <p className="text-sm text-(--text-muted)">
                    No wallet authenticated. Connect MetaMask and sign the EIP-712 challenge in the top bar to initialize a session.
                  </p>
                  <div className="shrink-0 font-mono text-xs text-(--text-faint)">
                    STATUS: WAITING_FOR_OPERATOR_SIGNATURE
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 4: OPERATIONAL LIFECYCLE (Optimus "How it Works" Style)
      ========================================================================= */}
      <section
        id="demo-sequence"
        className="relative py-24 lg:py-32 bg-(--text-primary) text-(--bg) overflow-hidden"
      >
        {/* Diagonal Hatch Watermark */}
        <div className="absolute inset-0 opacity-[0.035] pointer-events-none">
          <div
            style={{
              backgroundImage: `repeating-linear-gradient(-45deg, transparent, transparent 40px, currentColor 40px, currentColor 41px)`,
            }}
            className="absolute inset-0"
          />
        </div>

        <div className="relative z-10 max-w-350 mx-auto px-6 lg:px-12">
          <div className="mb-16 lg:mb-24">
            <span className="inline-flex items-center gap-3 text-xs sm:text-sm font-mono text-(--bg)/60 mb-6">
              <span className="w-8 h-px bg-(--bg)/30" />
              Process // LIFECYCLE_SEQUENCE
            </span>
            <h2 className="text-4xl lg:text-6xl font-display tracking-tight text-(--bg)">
              Seven steps.
              <br />
              <span className="text-(--bg)/60">Zero compromises.</span>
            </h2>
          </div>

          <div className="grid lg:grid-cols-2 gap-16 lg:gap-24 items-start">
            {/* Step Selector List */}
            <div className="space-y-0">
              {lifecycleSteps.map((step, idx) => {
                const isActive = activeStep === idx;
                return (
                  <button
                    key={step.num}
                    type="button"
                    onClick={() => setActiveStep(idx)}
                    className={`w-full text-left py-6 border-b border-(--bg)/15 transition-all duration-300 group ${
                      isActive ? "opacity-100" : "opacity-40 hover:opacity-75"
                    }`}
                  >
                    <div className="flex items-start gap-6">
                      <span className="font-display text-2xl lg:text-3xl text-(--bg)/40 shrink-0">
                        {step.num}
                      </span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xl lg:text-2xl font-display text-(--bg) mb-2 group-hover:translate-x-1 transition-transform">
                            {step.title}
                          </h3>
                          <Link
                            href={step.href}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs font-mono text-(--bg)/70 hover:text-(--bg) underline underline-offset-4"
                          >
                            Open →
                          </Link>
                        </div>
                        <p className="text-xs lg:text-sm text-(--bg)/70 leading-relaxed max-w-lg">
                          {step.desc}
                        </p>

                        {isActive && (
                          <div className="mt-4 h-0.5 bg-(--bg)/20 overflow-hidden rounded-full">
                            <div
                              style={{ animation: "progress 5s linear forwards" }}
                              className="h-full bg-(--bg) w-0"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Sticky Interactive Code Terminal */}
            <div className="lg:sticky lg:top-28 self-start">
              <div className="border border-(--bg)/20 rounded-xl overflow-hidden bg-(--bg)/5 backdrop-blur-sm">
                <div className="px-6 py-4 border-b border-(--bg)/15 flex items-center justify-between">
                  <div className="flex gap-2">
                    <div className="w-3 h-3 rounded-full bg-(--bg)/30" />
                    <div className="w-3 h-3 rounded-full bg-(--bg)/30" />
                    <div className="w-3 h-3 rounded-full bg-(--bg)/30" />
                  </div>
                  <span className="text-xs font-mono text-(--bg)/50">
                    {lifecycleSteps[activeStep].tag}.SOL
                  </span>
                </div>

                <div className="p-6 lg:p-8 font-mono text-xs sm:text-sm min-h-70">
                  <pre className="text-(--bg)/80 overflow-x-auto scroll-thin">
                    {lifecycleSteps[activeStep].code.split("\n").map((line, lIdx) => (
                      <div
                        key={`${activeStep}-${lIdx}`}
                        className="leading-loose code-line-reveal"
                        style={{ animationDelay: `${70 * lIdx}ms` }}
                      >
                        <span className="text-(--bg)/30 select-none w-8 inline-block">
                          {lIdx + 1}
                        </span>
                        <span className="inline-flex">
                          {line.split("").map((char, cIdx) => (
                            <span
                              key={`${activeStep}-${lIdx}-${cIdx}`}
                              className="code-char-reveal"
                              style={{ animationDelay: `${70 * lIdx + 12 * cIdx}ms` }}
                            >
                              {char === " " ? "\u00A0" : char}
                            </span>
                          ))}
                        </span>
                      </div>
                    ))}
                  </pre>
                </div>

                <div className="px-6 py-3.5 border-t border-(--bg)/15 flex items-center justify-between text-xs font-mono text-(--bg)/60">
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-(--success) animate-pulse" />
                    STATUS: READY_FOR_DISPATCH
                  </span>
                  <Link
                    href={lifecycleSteps[activeStep].href}
                    className="hover:text-(--bg) underline underline-offset-4"
                  >
                    Execute Module →
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 5: INFRASTRUCTURE & CONSENSUS (Optimus Infrastructure Style)
      ========================================================================= */}
      <section id="infrastructure" className="relative py-24 lg:py-32 border-b border-(--border) overflow-hidden">
        <div className="max-w-350 mx-auto px-6 lg:px-12">
          <div className="grid lg:grid-cols-2 gap-16 lg:gap-24 items-center">
            <div>
              <span className="inline-flex items-center gap-3 text-xs sm:text-sm font-mono text-(--text-muted) mb-6">
                <span className="w-8 h-px bg-(--text-primary)/30" />
                Infrastructure // CONSENSUS_GRID
              </span>
              <h2 className="text-4xl lg:text-6xl font-display tracking-tight text-(--text-primary) mb-8">
                Deterministic
                <br />
                by default.
              </h2>
              <p className="text-lg lg:text-xl text-(--text-muted) leading-relaxed mb-12">
                Deploy once, audit anywhere. Document operations are cryptographically signed, timestamped, and immutably pinned across distributed nodes with sub-50ms verification latency.
              </p>

              <div className="grid grid-cols-3 gap-8">
                <div>
                  <div className="text-4xl lg:text-5xl font-display text-(--text-primary) mb-2">3</div>
                  <div className="text-xs sm:text-sm text-(--text-muted)">Smart Contracts</div>
                </div>
                <div>
                  <div className="text-4xl lg:text-5xl font-display text-(--text-primary) mb-2">100%</div>
                  <div className="text-xs sm:text-sm text-(--text-muted)">Deterministic</div>
                </div>
                <div>
                  <div className="text-4xl lg:text-5xl font-display text-(--text-primary) mb-2">&lt;20ms</div>
                  <div className="text-xs sm:text-sm text-(--text-muted)">Proof Speed</div>
                </div>
              </div>
            </div>

            {/* Edge Network Ping Simulator */}
            <div>
              <div className="border border-(--border) rounded-2xl overflow-hidden bg-(--surface)">
                <div className="px-6 py-4 border-b border-(--border) flex items-center justify-between">
                  <span className="text-xs sm:text-sm font-mono text-(--text-muted)">Consensus RPC Nodes</span>
                  <span className="flex items-center gap-2 text-xs font-mono text-(--success)">
                    <span className="w-2 h-2 rounded-full bg-(--success) animate-pulse" />
                    All nodes synced
                  </span>
                </div>

                <div className="divide-y divide-(--border)">
                  {consensusNodes.map((node, i) => {
                    const isActive = activeNodeIdx === i;
                    return (
                      <div
                        key={node.name}
                        className={`px-6 py-4 flex items-center justify-between transition-colors duration-300 ${
                          isActive ? "bg-(--text-primary)/5" : ""
                        }`}
                      >
                        <div className="flex items-center gap-4">
                          <span
                            className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                              isActive ? "bg-(--text-primary)" : "bg-(--text-primary)/20"
                            }`}
                          />
                          <div>
                            <div className="font-medium text-sm text-(--text-primary)">{node.name}</div>
                            <div className="text-xs text-(--text-muted)">{node.region} · Chain {node.chainId}</div>
                          </div>
                        </div>
                        <span className="font-mono text-xs text-(--text-muted)">{node.latency}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 6: DEVELOPER SDK TERMINAL (Optimus Developers Style)
      ========================================================================= */}
      <section id="developers" className="relative py-24 lg:py-32 border-b border-(--border) overflow-hidden">
        <div className="max-w-350 mx-auto px-6 lg:px-12">
          <div className="grid lg:grid-cols-2 gap-16 lg:gap-24 items-start">
            <div>
              <span className="inline-flex items-center gap-3 text-xs sm:text-sm font-mono text-(--text-muted) mb-6">
                <span className="w-8 h-px bg-(--text-primary)/30" />
                For Developers // SDK_INTEGRATION
              </span>
              <h2 className="text-4xl lg:text-6xl font-display tracking-tight text-(--text-primary) mb-8">
                Built for devs.
                <br />
                <span className="text-(--text-muted)">Hardened for audits.</span>
              </h2>
              <p className="text-lg lg:text-xl text-(--text-muted) mb-12 leading-relaxed">
                A thoughtfully designed TypeScript and Smart Contract interface that gets out of your way. Integrate enterprise document authorization in minutes.
              </p>

              <div className="grid grid-cols-2 gap-8">
                <div>
                  <h3 className="font-medium text-sm text-(--text-primary) mb-1.5">TypeScript Native</h3>
                  <p className="text-xs text-(--text-muted) leading-relaxed">Full type safety with auto-generated Ethers typechains.</p>
                </div>
                <div>
                  <h3 className="font-medium text-sm text-(--text-primary) mb-1.5">Zero Config</h3>
                  <p className="text-xs text-(--text-muted) leading-relaxed">Runs on local Hardhat, Sepolia testnet, or Ethereum mainnet.</p>
                </div>
                <div>
                  <h3 className="font-medium text-sm text-(--text-primary) mb-1.5">Edge-Ready</h3>
                  <p className="text-xs text-(--text-muted) leading-relaxed">Compatible with Next.js, Node, Bun, and browser environments.</p>
                </div>
                <div>
                  <h3 className="font-medium text-sm text-(--text-primary) mb-1.5">Zero Dependencies</h3>
                  <p className="text-xs text-(--text-muted) leading-relaxed">Lightweight cryptography with standard Web Crypto & Ethers v6.</p>
                </div>
              </div>
            </div>

            {/* SDK Code Snippet Window with Tab Switcher */}
            <div className="border border-(--border) rounded-2xl overflow-hidden bg-(--surface)">
              <div className="flex items-center border-b border-(--border)">
                {devSnippets.map((snip, idx) => (
                  <button
                    key={snip.label}
                    type="button"
                    onClick={() => setDevTab(idx)}
                    className={`px-5 py-4 text-xs font-mono transition-colors relative ${
                      devTab === idx ? "text-(--text-primary) font-semibold" : "text-(--text-muted) hover:text-(--text-primary)"
                    }`}
                  >
                    {snip.label}
                    {devTab === idx && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-(--text-primary)" />}
                  </button>
                ))}
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(devSnippets[devTab].code);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                  className="px-4 py-4 text-(--text-muted) hover:text-(--text-primary) transition-colors"
                  aria-label="Copy code"
                >
                  {copied ? <Check className="w-4 h-4 text-(--success)" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>

              <div className="p-6 lg:p-8 font-mono text-xs sm:text-sm bg-(--bg) min-h-55">
                <pre className="text-(--text-primary)/90 overflow-x-auto scroll-thin">
                  {devSnippets[devTab].code.split("\n").map((line, lIdx) => (
                    <div key={`${devTab}-${lIdx}`} className="leading-loose">
                      <span className="inline-flex">{line === "" ? "\u00A0" : line}</span>
                    </div>
                  ))}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 7: SPOTLIGHT VERIFIER CARD (Optimus CTA Style)
      ========================================================================= */}
      <section className="relative py-24 lg:py-32 overflow-hidden border-b border-(--border)">
        <div className="max-w-350 mx-auto px-6 lg:px-12">
          <div
            className="relative border border-(--text-primary) rounded-3xl overflow-hidden transition-all duration-700 hover:shadow-2xl"
            onMouseMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setSpotlight({
                x: ((e.clientX - rect.left) / rect.width) * 100,
                y: ((e.clientY - rect.top) / rect.height) * 100,
              });
            }}
          >
            {/* Interactive Mouse Spotlight */}
            <div
              className="absolute inset-0 opacity-15 pointer-events-none transition-opacity duration-300"
              style={{
                background: `radial-gradient(600px circle at ${spotlight.x}% ${spotlight.y}%, rgba(8, 5, 3, 0.25), transparent 45%)`,
              }}
            />

            <div className="relative z-10 px-8 lg:px-16 py-16 lg:py-24">
              <div className="flex flex-col lg:flex-row items-center justify-between gap-12">
                <div className="flex-1 max-w-xl">
                  <h2 className="text-4xl lg:text-7xl font-display tracking-tight text-(--text-primary) mb-8 leading-[0.95]">
                    Independent.
                    <br />
                    Cryptographic.
                  </h2>
                  <p className="text-lg lg:text-xl text-(--text-muted) mb-12 leading-relaxed">
                    Verify any cryptographic proof bundle offline or on-chain without an account. Zero login credentials required.
                  </p>

                  <div className="flex flex-col sm:flex-row items-start gap-4">
                    <Link
                      href="/verify"
                      className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-mono font-medium bg-(--text-primary) hover:opacity-90 text-(--bg) px-8 h-14 rounded-full group transition-all"
                    >
                      <span>Open Verifier Engine</span>
                      <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                    </Link>

                    <Link
                      href="/assets"
                      className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-mono font-medium border border-(--border) hover:border-(--text-primary) bg-(--surface) px-8 h-14 rounded-full transition-all"
                    >
                      <span>Manage Documents</span>
                    </Link>
                  </div>
                </div>

                {/* 3D ASCII Crypto Cube Visualizer */}
                <div className="w-75 h-75 sm:w-100 sm:h-100 lg:w-112.5 lg:h-112.5 shrink-0">
                  <AsciiCryptoCube />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* =========================================================================
          SECTION 8: BESPOKE FOOTER (Optimus Footer Style)
      ========================================================================= */}
      <footer className="relative border-t border-(--border) overflow-hidden">
        {/* Wave Field Canvas Matrix Background */}
        <div className="absolute inset-0 h-64 opacity-20 pointer-events-none overflow-hidden">
          <AsciiWaveField />
        </div>

        <div className="relative z-10 max-w-350 mx-auto px-6 lg:px-12 py-16 lg:py-24">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-12 lg:gap-8">
            <div className="col-span-2">
              <Link href="/" className="inline-flex items-center gap-2.5 mb-4 group">
                <Image
                  src="/pramaan-icon.png"
                  alt="PRAMAAN Emblem"
                  width={28}
                  height={28}
                  className="w-7 h-7 object-contain"
                />
                <span className="text-xl font-pramaan font-bold tracking-wider text-(--text-primary)">PRAMAAN</span>
                <span className="text-[10px] font-mono text-(--text-muted) px-1 py-0.5 rounded border border-(--border)">TM</span>
              </Link>
              <p className="text-xs text-(--text-muted) leading-relaxed mb-6 max-w-xs">
                Zero-trust document authorization at block speed. Smart India Hackathon 2026 Problem Statement 26125.
              </p>
            </div>

            <div>
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-(--text-primary) mb-4">Modules</h3>
              <ul className="space-y-3 text-xs font-mono text-(--text-muted)">
                <li><Link href="/identities" className="hover:text-(--text-primary) transition-colors">Identities</Link></li>
                <li><Link href="/assets" className="hover:text-(--text-primary) transition-colors">Assets Vault</Link></li>
                <li><Link href="/permissions" className="hover:text-(--text-primary) transition-colors">Permissions</Link></li>
                <li><Link href="/download" className="hover:text-(--text-primary) transition-colors">Download</Link></li>
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-(--text-primary) mb-4">Audits</h3>
              <ul className="space-y-3 text-xs font-mono text-(--text-muted)">
                <li><Link href="/policy-check" className="hover:text-(--text-primary) transition-colors">Policy-at-Time</Link></li>
                <li><Link href="/verify" className="hover:text-(--text-primary) transition-colors">Verify Bundle</Link></li>
                <li><a href="#metrics" className="hover:text-(--text-primary) transition-colors">Telemetry</a></li>
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-(--text-primary) mb-4">Contracts</h3>
              <ul className="space-y-3 text-xs font-mono text-(--text-muted)">
                <li><span className="text-(--text-faint)">IdentityRegistry.sol</span></li>
                <li><span className="text-(--text-faint)">AccessControl.sol</span></li>
                <li><span className="text-(--text-faint)">AssetRegistry.sol</span></li>
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-(--text-primary) mb-4">Security</h3>
              <ul className="space-y-3 text-xs font-mono text-(--text-muted)">
                <li><span className="text-(--text-faint)">AES-256-GCM</span></li>
                <li><span className="text-(--text-faint)">EIP-712 Auth</span></li>
                <li><span className="text-(--text-faint)">OpenZeppelin</span></li>
              </ul>
            </div>
          </div>

          <div className="mt-16 pt-8 border-t border-(--border) flex flex-col md:flex-row items-center justify-between gap-4 text-xs font-mono text-(--text-muted)">
            <p>© 2026 <span className="font-pramaan font-bold">PRAMAAN</span>™. Built for Smart India Hackathon (SIH 2026).</p>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-(--success) animate-pulse" />
              <span>All Systems Operational · Hardhat Node 31337</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
