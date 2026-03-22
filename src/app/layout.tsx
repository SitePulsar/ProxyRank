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

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      "name": "ProxyRank",
      "url": "https://proxyrank.vercel.app",
      "description": "ProxyRank audits MCP servers and CLI tools with a 0–100 ProxyScore predicting how likely an AI orchestrator selects your agent over 26,000+ competitors.",
      "applicationCategory": "DeveloperApplication",
      "operatingSystem": "Web",
      "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
    },
    {
      "@type": "FAQPage",
      "mainEntity": [
        {
          "@type": "Question",
          "name": "What is a ProxyScore?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "ProxyScore is a 0–100 score that predicts how likely an AI orchestrator (LangGraph, CrewAI, OpenAI Assistants) selects your MCP server or CLI tool over competitors. It measures Semantic Discovery (35 pts), Schema quality (30 pts), Reliability (25 pts), and Governance (10 pts).",
          },
        },
        {
          "@type": "Question",
          "name": "What is an MCP server?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "MCP (Model Context Protocol) is an open standard for integrating tools with AI agents. MCP servers expose tools that AI orchestrators like Claude, LangGraph, and CrewAI can discover and call autonomously. There are over 26,000 discoverable MCP servers.",
          },
        },
        {
          "@type": "Question",
          "name": "How do I make my agent discoverable by AI orchestrators?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "To maximize orchestrator selection, your MCP server should have: imperative verb tool names (e.g. 'generate_report' not 'report'), detailed descriptions under 250 characters, complete JSON parameter schemas with required arrays, and output schemas. ProxyRank audits all four layers and suggests specific improvements.",
          },
        },
        {
          "@type": "Question",
          "name": "Is ProxyRank free?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Yes. The basic ProxyRank audit (75 of 100 points) is always free. Full 100-point scoring including live reliability probes is available in Phase 2.",
          },
        },
      ],
    },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
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
