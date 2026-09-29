import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/lib/ThemeContext";
import { AuthProvider } from "@/lib/AuthContext";
import { NavBar } from "@/components/NavBar";
import { NetworkBanner } from "@/components/NetworkBanner";
import { SessionResetBanner } from "@/components/SessionResetBanner";
import { IBM_Plex_Sans, IBM_Plex_Mono, Orbitron } from "next/font/google";

const orbitron = Orbitron({
  subsets: ["latin"],
  variable: "--font-orbitron",
  display: "swap",
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-ibm-plex-sans",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PRAMAAN™ — Zero-Trust Blockchain Access Control & Cryptographic Audits",
  description:
    "Zero-trust document security infrastructure. On-chain access policies, verifiable proof bundles, and cryptographic temporal audits. SIH 2026 // PS 26125 // Team ID: 152562.",
  icons: {
    icon: "/pramaan-icon.png",
    shortcut: "/pramaan-icon.png",
    apple: "/pramaan-icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${ibmPlexSans.variable} ${ibmPlexMono.variable} ${orbitron.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function() {
  try {
    var saved = localStorage.getItem('pramaan-theme') || localStorage.getItem('trustledger-theme');
    var theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {}
})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-(--bg) text-(--text-primary) font-sans noise-overlay">
        <ThemeProvider>
          <AuthProvider>
            <NavBar />
            <SessionResetBanner />
            <NetworkBanner />
            <main className="flex-1 w-full">
              {children}
            </main>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
