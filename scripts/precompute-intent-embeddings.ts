/**
 * Precompute intent embeddings for constants.ts
 *
 * Run once: npm run precompute-intents
 *
 * This script fetches OpenAI embeddings for all 36 agentic intents and
 * prints them as a JSON array. Paste the output into AGENTIC_INTENTS in
 * src/lib/constants.ts, adding the `embedding` field to each intent.
 *
 * Cost: ~$0.000036 for 36 strings at text-embedding-3-small pricing.
 */

import "dotenv/config";
import OpenAI from "openai";
import { AGENTIC_INTENTS } from "../src/lib/constants.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY must be set in .env.local");
  }

  console.error(`Computing embeddings for ${AGENTIC_INTENTS.length} intents...`);

  const results = [];

  for (const intent of AGENTIC_INTENTS) {
    const res = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: intent.text,
    });
    results.push({
      label: intent.label,
      text: intent.text,
      embedding: res.data[0].embedding,
    });
    process.stderr.write(`  ✓ ${intent.label}\n`);
  }

  console.log(JSON.stringify(results, null, 2));
  console.error("\nDone. Paste the JSON array above into AGENTIC_INTENTS in src/lib/constants.ts");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
