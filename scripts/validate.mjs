// scripts/validate.mjs
import { readFile } from "node:fs/promises";
import { CATEGORIES } from "../categories.mjs";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isIsoDate(v) {
  return typeof v === "string" && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v));
}
function isUrl(v) {
  try { new URL(v); return true; } catch { return false; }
}
function isPrice(v) {
  return v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
}

// Returns an array of human-readable error strings. Empty array = valid.
export function validate(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object") return ["root: document is not an object"];
  if (!isIsoDate(doc.generated_at)) errors.push("generated_at: must be an ISO date (YYYY-MM-DD)");
  if (!Array.isArray(doc.services)) return [...errors, "services: must be an array"];

  const seen = new Set();
  doc.services.forEach((s, i) => {
    const at = `services[${i}]`;
    const need = (cond, msg) => { if (!cond) errors.push(`${at}: ${msg}`); };

    need(typeof s.id === "string" && KEBAB.test(s.id), "id must be kebab-case string");
    if (typeof s.id === "string") {
      if (seen.has(s.id)) errors.push(`${at}: duplicate id "${s.id}"`);
      seen.add(s.id);
    }
    need(typeof s.name === "string" && s.name.length > 0, "name is required");
    need(CATEGORIES.includes(s.category), `category "${s.category}" not in known categories`);
    need(isUrl(s.url), "url must be a valid URL");
    need(typeof s.description === "string", "description is required");
    need(typeof s.free_tier === "boolean", "free_tier must be boolean");
    need(typeof s.headline_plan === "string" && s.headline_plan.length > 0, "headline_plan is required");
    need(isPrice(s.monthly_usd), "monthly_usd must be a number or null");
    need(isPrice(s.annual_usd), "annual_usd must be a number or null");
    need(isUrl(s.source_url), "source_url must be a valid URL");
    need(isIsoDate(s.last_verified), "last_verified must be an ISO date (YYYY-MM-DD)");
  });
  return errors;
}

// CLI entry: validate data/services.json relative to repo root.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const path = new URL("../data/services.json", import.meta.url);
  const doc = JSON.parse(await readFile(path, "utf8"));
  const errors = validate(doc);
  if (errors.length) {
    console.error(`✗ ${errors.length} validation error(s):`);
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  console.log(`✓ ${doc.services.length} services valid`);
}
