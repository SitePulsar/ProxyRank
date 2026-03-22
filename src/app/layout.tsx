import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/providers/theme-provider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
};

export const metadata: Metadata = {
  title: {
    default: "ProxyRank | Agent Discoverability Audit",
    template: "%s | ProxyRank",
  },
  description:
    "Score your MCP server or CLI tool against the 4-layer ProxyRank rubric. Know exactly how likely an AI orchestrator is to pick your agent over competitors.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "https://proxyrank.ai"
  ),
  alternates: { canonical: "/" },
  openGraph: {
    title: "ProxyRank | Agent Discoverability Audit",
    description:
      "Make your agent the first one picked by orchestrators. Free MCP audit. 0–100 ProxyScore.",
    url: "https://proxyrank.ai",
    siteName: "ProxyRank",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "ProxyRank | Agent Discoverability Audit",
    description:
      "Make your agent the first one picked by AI orchestrators. Free MCP scan.",
  },
  robots: { index: true, follow: true },
  keywords: [
    "MCP server audit",
    "agent discoverability",
    "orchestrator optimization",
    "ProxyScore",
    "MCP optimization",
    "agentic web",
    "LangGraph tools",
    "Claude tools",
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
