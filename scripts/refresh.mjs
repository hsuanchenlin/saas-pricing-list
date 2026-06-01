// scripts/refresh.mjs
// Re-verifies each service's headline-plan price via Claude + web search.
// SAFETY: never overwrites a price that cannot be verified — keeps the prior
// value and leaves last_verified unchanged.
import { readFile, writeFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { validate } from "./validate.mjs";

const TODAY = new Date().toISOString().slice(0, 10);
const dataPath = new URL("../data/services.json", import.meta.url);
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const RESULT_SCHEMA = `Return ONLY a JSON object:
{"verified": boolean, "monthly_usd": number|null, "annual_usd": number|null, "source_url": string}
verified=false if you are not confident. monthly_usd/annual_usd are the headline plan price in USD; annual_usd is the total yearly cost if billed annually, else null.`;

async function checkService(s) {
  const msg = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
    messages: [{
      role: "user",
      content: `Find the CURRENT US price (USD) of the "${s.headline_plan}" plan for ${s.name} (${s.url}). ${RESULT_SCHEMA}`,
    }],
  });
  const text = msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { verified: false };
  try { return JSON.parse(match[0]); } catch { return { verified: false }; }
}

const doc = JSON.parse(await readFile(dataPath, "utf8"));
let updated = 0, kept = 0;
for (const s of doc.services) {
  let r;
  try { r = await checkService(s); } catch (e) { console.error(`! ${s.id}: ${e.message}`); r = { verified: false }; }
  if (r && r.verified) {
    s.monthly_usd = r.monthly_usd ?? s.monthly_usd;
    s.annual_usd = r.annual_usd ?? null;
    if (r.source_url) s.source_url = r.source_url;
    s.last_verified = TODAY;
    updated++;
  } else {
    console.warn(`~ ${s.id}: not verified, keeping prior value`);
    kept++;
  }
}
doc.generated_at = TODAY;

const errors = validate(doc);
if (errors.length) {
  console.error("Refusing to write — validation failed:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}
await writeFile(dataPath, JSON.stringify(doc, null, 2) + "\n");
console.log(`✓ refreshed ${updated} services, kept ${kept} unverified, ${doc.services.length} total`);
