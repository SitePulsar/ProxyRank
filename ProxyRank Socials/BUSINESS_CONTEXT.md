# ProxyRank.ai — Brand & Context Brief

> This file is injected into every AI-generated prompt for community replies,
> content drafts, and strategic suggestions. Keep it up to date.

---

## Product

**ProxyRank.ai** is an audit and optimization platform for MCP (Model Context Protocol)
servers and CLI tools. It analyzes how discoverable your tool is to AI orchestrators —
and tells you exactly what to fix to rank first.

When an AI orchestrator (Claude, GPT-4, an open-source agent framework) needs to pick
a tool, ProxyRank answers: are you visible? Are you ranked? Are you the first pick — or
invisible?

---

## Mission

**Make your MCP server or CLI tool the first pick for AI orchestrators.**

---

## Audience

- Developers building MCP servers
- CLI tool authors who want AI agents to discover and use their tools
- AI agent and orchestrator builders
- Platform engineers integrating tools into LLM workflows

These are technical people. They read HN. They ship things on weekends. They value
directness over polish and data over claims. Don't tell them what to do — show them
the numbers.

---

## Tone

- Technical, direct, data-driven
- Developer-to-developer — peer, not vendor
- Credible through specificity, not hype
- **HN register:** measured, carefully sourced, occasionally contrarian but never edgy
- **Reddit register:** conversational, detailed, genuinely helpful — no pitch
- **X register:** short, concrete, punchy — one clean point per post

**Never use:** buzzword soup ("leverage synergies"), vague promises, excessive emojis,
corporate voice, or calls to action in community replies unless the thread is explicitly
about tools/products.

---

## Key Concepts

| Term | What it means |
|------|---------------|
| **Agent discoverability** | Whether AI orchestrators can find, understand, and select your tool automatically |
| **MCP (Model Context Protocol)** | Anthropic's open standard for connecting AI models to external tools and data sources |
| **AI orchestrator** | A system (agent framework, LLM app, Claude, GPT function-calling) that picks and invokes tools autonomously |
| **Tool ranking** | How prominently your tool surfaces in an orchestrator's selection process relative to alternatives |
| **CLI discoverability** | Whether your CLI tool can be discovered and invoked correctly by AI agents operating in a shell |

---

## Platforms & Strategy

| Platform | Primary use | Tone | When to mention ProxyRank |
|----------|-------------|------|---------------------------|
| **Hacker News** | Authority building, launch posts, thoughtful replies to MCP/agent threads | Careful, precise, no hype — HN will roast you | Only if directly asked about tools/auditing |
| **Reddit** | Community presence, genuine help in relevant subs, AMAs | Conversational, add real value first | Only if thread is about discoverability/ranking |
| **X (Twitter)** | Data points, hot takes, thread starters, developer mindshare | Short, concrete, sometimes provocative (technically) | Natural only — never forced |

### Relevant subreddits
`r/artificial` · `r/MachineLearning` · `r/AIagents` · `r/OpenAI` ·
`r/LocalLLaMA` · `r/LocalAI` · `r/Ollama` · `r/MCP` · `r/ModelContextProtocol`

### Keywords to monitor
`MCP` · `ProxyRank` · `"Model Context Protocol"` · `"AI agent"` · `"CLI tool"`

---

## Reply guidance for community posts

When replying to community posts (HN, Reddit, X):

1. **Lead with value** — answer the question or add a genuine insight first
2. **Mention ProxyRank only if naturally relevant** — never shoehorn it in
3. **Be specific** — cite the protocol spec, the concrete tradeoff, the real number
4. **Match the platform register** — see tone table above
5. **2–3 sentences is the target** for unsolicited replies; go longer only if answering a direct question
6. **No calls to action** unless the thread is explicitly asking for tool recommendations

---

## Product details, pricing & status

```
Status:           Public — live at proxyrank.ai
URL:              https://proxyrank.ai

Pricing:          Free (no paywall at launch)

Key features:
  - MCP server audit: scores Semantic (35%), Schema (30%), Reliability (25%), Governance (10%)
  - CLI tool audit: checks discoverability by AI orchestrators
  - Selection Probability Lift score: quantifies how likely orchestrators are to pick your tool
    (exponential curve, calibrated so score 50 = 1× baseline, score 80 = 2.7×, score 95 = 4.5×)
  - Rewrite suggestions: concrete fixes to improve your score
  - 36 agentic intent vectors (v1.1) used for semantic alignment scoring

Current traction:  Early — product live, building initial user base
Launch date:       2026
GitHub / Docs:     Not yet public

One-liner (≤ 15 words):
  "Audit your MCP server and fix why AI orchestrators skip it."
```

---

*Last updated: <!-- date -->*
