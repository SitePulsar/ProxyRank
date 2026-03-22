import type { CLIFlag, ParsedCLITool } from "./types";
import { countApproximateTokens } from "./mcp-parser";

// ─── Flag extraction ───────────────────────────────────────────────────────────

/**
 * Extracts flags from --help output.
 * Matches lines like:  --flag, -f       Description text
 */
function extractFlags(helpText: string): CLIFlag[] {
  const flags: CLIFlag[] = [];
  // Match lines that contain at least one --flag
  const flagLineRe = /^\s*((?:-[a-zA-Z],\s*)?--[\w-][\w-]*(?:[=\s][\w<>[\]|]+)?)\s{2,}(.*)?$/gm;

  let match: RegExpExecArray | null;
  while ((match = flagLineRe.exec(helpText)) !== null) {
    const raw = match[1].trim();
    const desc = match[2]?.trim();

    // Split "-f, --flag" into short + long
    const parts = raw.split(/,\s*/);
    let short: string | undefined;
    let name = "";

    for (const part of parts) {
      const p = part.trim().split(/[\s=]/)[0];
      if (p.startsWith("--")) name = p;
      else if (p.startsWith("-")) short = p;
    }

    if (!name) continue;

    // Detect enum values like --output=<json|text|yaml> or [json, text]
    const enumMatch = raw.match(/[<[]([\w|,\s]+)[>\]]/);
    const values = enumMatch
      ? enumMatch[1].split(/[|,\s]+/).filter(Boolean)
      : undefined;

    flags.push({ name, short, description: desc || undefined, values });
  }

  return flags;
}

// ─── Subcommand extraction ────────────────────────────────────────────────────

/**
 * Extracts subcommands from common --help patterns.
 * Looks for sections like "Commands:", "Available commands:", etc.
 */
function extractSubcommands(helpText: string): string[] {
  const subcommands: string[] = [];

  // Find command section header
  const sectionRe = /^(?:commands?|available commands?|subcommands?):?\s*$/im;
  const sectionMatch = sectionRe.exec(helpText);

  if (sectionMatch) {
    // Take lines after the section header until blank line or next section
    const after = helpText.slice(sectionMatch.index + sectionMatch[0].length);
    const lines = after.split("\n");
    let started = false;
    for (const line of lines) {
      if (!started && !line.trim()) continue; // skip leading blank lines after header
      started = true;
      if (!line.trim()) break; // first blank line after content = end of section
      if (/^[A-Z]/.test(line.trim())) break; // new section header
      // Line like "  deploy    Deploy to production"
      const cmdMatch = line.match(/^\s{2,}([a-z][\w-]+)\s{2,}/);
      if (cmdMatch) subcommands.push(cmdMatch[1]);
    }
  }

  return subcommands;
}

// ─── Description extraction ───────────────────────────────────────────────────

function extractDescription(helpText: string, name: string): string {
  const lines = helpText.split("\n").map((l) => l.trim()).filter(Boolean);

  // Skip the first line if it's just the command name / usage header
  for (const line of lines) {
    if (/^usage:/i.test(line)) continue;
    if (line.toLowerCase().startsWith(name.toLowerCase())) continue;
    if (/^options?:/i.test(line)) break;
    if (/^commands?:/i.test(line)) break;
    if (line.length > 20) return line;
  }

  return lines[0] ?? "";
}

// ─── Name extraction ──────────────────────────────────────────────────────────

function extractName(helpText: string, provided?: string): string {
  if (provided?.trim()) return provided.trim();

  // Usage: <name> [options]
  const usageMatch = helpText.match(/^usage:\s+([\w@/-]+)/im);
  if (usageMatch) return usageMatch[1];

  // First word of first line
  const firstLine = helpText.trim().split("\n")[0].trim();
  const firstWord = firstLine.split(/\s/)[0];
  return firstWord || "unknown";
}

// ─── Detection helpers ────────────────────────────────────────────────────────

function detectJsonOutput(flags: CLIFlag[], rawHelp: string): boolean {
  // Explicit --json flag
  if (flags.some((f) => f.name === "--json")) return true;

  // --output or --format flag whose enum values or description include "json"
  const outputFlag = flags.find((f) => f.name === "--output" || f.name === "--format");
  if (outputFlag?.values?.some((v) => v.toLowerCase() === "json")) return true;
  if (outputFlag?.description?.toLowerCase().includes("json")) return true;

  // Free-text patterns: "--output json", "--output=json", or --output/--format line
  // near the word "json" (catches "(json|text|yaml)" style enumerations)
  return (
    /--(?:output|format)[=\s]+json|--json\b/i.test(rawHelp) ||
    (/--(?:output|format)/i.test(rawHelp) && /\bjson\b/i.test(rawHelp))
  );
}

function detectNonInteractive(flags: CLIFlag[], rawHelp: string): boolean {
  const nonInteractiveFlags = [
    "--no-input", "--no-interactive", "--non-interactive",
    "--ci", "--yes", "-y", "--force", "--quiet",
  ];
  if (flags.some((f) => nonInteractiveFlags.includes(f.name))) return true;
  return /--(?:no-input|no-interactive|non-interactive|ci|yes)\b/i.test(rawHelp);
}

function detectHelpFlag(flags: CLIFlag[], rawHelp: string): boolean {
  if (flags.some((f) => f.name === "--help" || f.short === "-h")) return true;
  return /--help\b|-h\b/i.test(rawHelp);
}

// ─── Main parser ──────────────────────────────────────────────────────────────

/**
 * Parses a CLI --help output string into a structured ParsedCLITool.
 *
 * @param helpText  Raw output of `<tool> --help`
 * @param name      Optional override for the tool name (auto-detected if omitted)
 */
export function parseCLIHelp(helpText: string, name?: string): ParsedCLITool {
  const raw = helpText.trim();
  const resolvedName = extractName(raw, name);
  const flags = extractFlags(raw);
  const subcommands = extractSubcommands(raw);
  const description = extractDescription(raw, resolvedName);

  return {
    name: resolvedName,
    description,
    rawHelp: raw,
    flags,
    subcommands,
    hasJsonOutput: detectJsonOutput(flags, raw),
    hasNonInteractiveMode: detectNonInteractive(flags, raw),
    hasHelpFlag: detectHelpFlag(flags, raw),
    totalTokens: countApproximateTokens(raw),
  };
}
