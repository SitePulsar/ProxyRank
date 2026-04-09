import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "ProxyRank — Agent Discoverability Audit";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          background: "#0a0a0a",
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "80px",
          fontFamily: "sans-serif",
          position: "relative",
          overflow: "hidden",
        }}
      >
        {/* Background glow */}
        <div
          style={{
            position: "absolute",
            top: "-120px",
            right: "-120px",
            width: "500px",
            height: "500px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(99,102,241,0.25) 0%, transparent 70%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "-80px",
            left: "200px",
            width: "400px",
            height: "400px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(99,102,241,0.1) 0%, transparent 70%)",
          }}
        />

        {/* Badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            background: "rgba(99,102,241,0.15)",
            border: "1px solid rgba(99,102,241,0.4)",
            borderRadius: "999px",
            padding: "8px 20px",
            marginBottom: "36px",
          }}
        >
          <span style={{ color: "#818cf8", fontSize: "18px", fontWeight: 600, letterSpacing: "0.05em" }}>
            MCP SERVER RELIABILITY
          </span>
        </div>

        {/* Headline */}
        <div style={{ display: "flex", alignItems: "baseline", gap: "16px", marginBottom: "16px" }}>
          <span style={{ color: "#ffffff", fontSize: "80px", fontWeight: 800, lineHeight: 1 }}>
            Proxy
          </span>
          <span style={{ color: "#6366f1", fontSize: "80px", fontWeight: 800, lineHeight: 1 }}>
            Rank
          </span>
        </div>

        {/* Subline */}
        <p
          style={{
            color: "#9ca3af",
            fontSize: "28px",
            lineHeight: 1.4,
            margin: 0,
            maxWidth: "780px",
            marginBottom: "56px",
          }}
        >
          Audit your MCP server. Get your ProxyScore.<br />
          Be the agent orchestrators pick first.
        </p>

        {/* Stats row */}
        <div style={{ display: "flex", gap: "48px" }}>
          {[
            { num: "26k+", label: "MCP Servers Tracked" },
            { num: "0–100", label: "ProxyScore" },
            { num: "Free", label: "Audit" },
          ].map(({ num, label }) => (
            <div key={label} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ color: "#ffffff", fontSize: "36px", fontWeight: 700 }}>{num}</span>
              <span style={{ color: "#6b7280", fontSize: "18px" }}>{label}</span>
            </div>
          ))}
        </div>

        {/* Domain */}
        <div
          style={{
            position: "absolute",
            bottom: "48px",
            right: "80px",
            color: "#4b5563",
            fontSize: "22px",
            letterSpacing: "0.05em",
          }}
        >
          proxyrank.ai
        </div>
      </div>
    ),
    { ...size }
  );
}
