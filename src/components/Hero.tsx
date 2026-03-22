"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Zap, ArrowRight, Globe, Terminal } from "lucide-react";

function isValidUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

type Mode = "mcp" | "cli";

export function Hero() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("mcp");
  const [url, setUrl] = useState("");
  const [helpText, setHelpText] = useState("");
  const [cliName, setCliName] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function clearError() {
    if (error) setError(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    if (mode === "mcp") {
      const trimmed = url.trim();
      if (!trimmed) { setError("Please enter a URL."); return; }
      if (!isValidUrl(trimmed)) { setError("That doesn't look like a valid URL. Include https://"); return; }

      setIsLoading(true);
      try {
        const res = await fetch("/api/audit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: trimmed }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error ?? "Something went wrong."); return; }
        router.push(`/results/${data.auditId}`);
      } catch {
        setError("Network error — check your connection and try again.");
      } finally {
        setIsLoading(false);
      }
    } else {
      const trimmed = helpText.trim();
      if (!trimmed || trimmed.length < 10) { setError("Please paste at least 10 characters of --help output."); return; }

      setIsLoading(true);
      try {
        const res = await fetch("/api/audit-cli", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ helpText: trimmed, name: cliName.trim() || undefined }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error ?? "Something went wrong."); return; }
        router.push(`/results/${data.auditId}`);
      } catch {
        setError("Network error — check your connection and try again.");
      } finally {
        setIsLoading(false);
      }
    }
  }

  return (
    <>
      {/* Navbar */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-sm">
        <div className="container flex h-14 items-center justify-between">
          <a href="/" className="flex items-center gap-2.5">
            <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden>
              <circle cx="16" cy="16" r="14" stroke="url(#g1)" strokeWidth="1.2" opacity="0.35"/>
              <ellipse cx="16" cy="16" rx="14" ry="6" stroke="url(#g1)" strokeWidth="1.2" opacity="0.55" transform="rotate(-35 16 16)"/>
              <ellipse cx="16" cy="16" rx="14" ry="6" stroke="url(#g1)" strokeWidth="1.2" opacity="0.55" transform="rotate(35 16 16)"/>
              <line x1="4" y1="6" x2="28" y2="26" stroke="url(#g2)" strokeWidth="1.5" opacity="0.7"/>
              <circle cx="16" cy="16" r="2.5" fill="url(#g1)"/>
              <defs>
                <linearGradient id="g1" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#3B82F6"/>
                  <stop offset="1" stopColor="#06B6D4"/>
                </linearGradient>
                <linearGradient id="g2" x1="4" y1="6" x2="28" y2="26" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#60A5FA"/>
                  <stop offset="1" stopColor="#34D399"/>
                </linearGradient>
              </defs>
            </svg>
            <span className="font-bold text-foreground tracking-tight">ProxyRank</span>
          </a>
          <div className="flex items-center gap-4">
            <a href="/examples" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Examples
            </a>
            <a
              href="https://github.com/SitePulsar/ProxyRank"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              GitHub
            </a>
            <a
              href="#audit"
              className="rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
            >
              Run Audit
            </a>
          </div>
        </div>
      </nav>

    <section id="audit" className="relative flex flex-col items-center justify-center min-h-screen px-4 py-24 text-center overflow-hidden">
      {/* Background glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% -10%, oklch(0.568 0.243 264.376 / 0.22), transparent)",
        }}
      />

      {/* Badge */}
      <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-1.5 text-xs text-muted-foreground">
        <Zap className="h-3 w-3 text-primary" />
        The Quality Control Layer for the Agentic Economy
      </div>

      {/* Headline */}
      <h1 className="max-w-3xl text-5xl font-bold tracking-tight text-foreground sm:text-6xl md:text-7xl">
        Make your agent the{" "}
        <span className="bg-gradient-to-r from-blue-400 via-cyan-400 to-emerald-400 bg-clip-text text-transparent">
          first one picked
        </span>{" "}
        by orchestrators
      </h1>

      <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
        Get a free{" "}
        <strong className="text-foreground">ProxyScore 0–100</strong> — the
        single number that predicts how likely an AI orchestrator selects your
        agent over 26,000+ competitors.
      </p>

      {/* Mode toggle */}
      <div className="mt-10 inline-flex rounded-lg border border-border bg-card p-1 gap-1">
        <button
          type="button"
          onClick={() => { setMode("mcp"); clearError(); }}
          className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            mode === "mcp"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Globe className="h-3.5 w-3.5" />
          MCP Server
        </button>
        <button
          type="button"
          onClick={() => { setMode("cli"); clearError(); }}
          className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
            mode === "cli"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Terminal className="h-3.5 w-3.5" />
          CLI Tool
        </button>
      </div>

      {/* Form */}
      <form
        onSubmit={handleSubmit}
        className="mt-4 w-full max-w-2xl space-y-3"
        noValidate
      >
        {mode === "mcp" ? (
          <div className="flex flex-col gap-3 sm:flex-row">
            <input
              type="url"
              value={url}
              onChange={(e) => { setUrl(e.target.value); clearError(); }}
              placeholder="https://your-agent.com/.well-known/mcp.json"
              disabled={isLoading}
              className="flex-1 rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
              aria-label="MCP server URL"
            />
            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {isLoading ? <><Loader2 className="h-4 w-4 animate-spin" />Auditing…</> : <>Audit my agent<ArrowRight className="h-4 w-4" /></>}
            </button>
          </div>
        ) : (
          <div className="space-y-3 text-left">
            <input
              type="text"
              value={cliName}
              onChange={(e) => { setCliName(e.target.value); clearError(); }}
              placeholder="Tool name (optional — auto-detected from help text)"
              disabled={isLoading}
              className="w-full rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
            />
            <textarea
              value={helpText}
              onChange={(e) => { setHelpText(e.target.value); clearError(); }}
              placeholder={"Paste your CLI --help output here…\n\nExample:\n  $ mytool --help\n  Usage: mytool [options] <command>\n\n  A tool that does X for AI agents.\n\n  Options:\n    --json       Output as JSON\n    --ci         Non-interactive mode\n    --help, -h   Show help"}
              disabled={isLoading}
              rows={10}
              className="w-full rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 font-mono resize-y"
              aria-label="CLI --help output"
            />
            <button
              type="submit"
              disabled={isLoading}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? <><Loader2 className="h-4 w-4 animate-spin" />Auditing…</> : <>Audit my CLI tool<ArrowRight className="h-4 w-4" /></>}
            </button>
          </div>
        )}

        {/* Error message */}
        {error && (
          <p className="text-sm text-destructive text-left" role="alert">
            {error}
          </p>
        )}
      </form>

      {/* Try a public MCP server (only shown in MCP mode) */}
      {mode === "mcp" && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <span className="text-xs text-muted-foreground self-center">Try a public server:</span>
          {[
            { label: "1stDibs", url: "https://www.1stdibs.com/soa/mcp/" },
            { label: "Stayker Hotels", url: "https://mcp.stayker.com/mcp" },
            { label: "0nMCP", url: "https://0nmcp.com/api/mcp" },
            { label: "123elec", url: "https://mcp.123elec.com/mcp" },
          ].map(({ label, url: exampleUrl }) => (
            <button
              key={label}
              type="button"
              onClick={() => { setUrl(exampleUrl); setError(null); }}
              className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-primary transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Social proof / stats */}
      <div className="mt-16 flex flex-wrap justify-center gap-8 text-center">
        {[
          { value: "26,725+", label: "MCP servers discoverable" },
          { value: "4 layers", label: "Semantic · Schema · Reliability · Governance" },
          { value: "Free", label: "Basic scan, always" },
        ].map((stat) => (
          <div key={stat.label} className="space-y-1">
            <p className="text-2xl font-bold text-foreground">{stat.value}</p>
            <p className="text-xs text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Example link */}
      <p className="mt-8 text-xs text-muted-foreground">
        Want to see how it works first?{" "}
        <a href="/examples" className="text-primary hover:underline">
          View gold standard audits →
        </a>
      </p>
    </section>
    </>
  );
}
