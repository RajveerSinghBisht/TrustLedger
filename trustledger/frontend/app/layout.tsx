import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/lib/ThemeContext";
import { AuthProvider } from "@/lib/AuthContext";
import { NavBar } from "@/components/NavBar";
import { NetworkBanner } from "@/components/NetworkBanner";
import { SessionResetBanner } from "@/components/SessionResetBanner";
import { Instrument_Serif, Instrument_Sans, JetBrains_Mono, Orbitron } from "next/font/google";

const orbitron = Orbitron({
  subsets: ["latin"],
  variable: "--font-orbitron",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-instrument-serif",
  display: "swap",
});

const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PRAMAAN™ — Enterprise Blockchain Access Control & Cryptographic Audits",
  description:
    "The zero-trust document security infrastructure for teams who ship. On-chain access policies, verifiable proof bundles, and cryptographic temporal audits.",
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
      className={`${instrumentSerif.variable} ${instrumentSans.variable} ${jetbrainsMono.variable} ${orbitron.variable} h-full antialiased`}
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
