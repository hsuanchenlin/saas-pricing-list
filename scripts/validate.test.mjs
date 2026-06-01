// scripts/validate.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { validate } from "./validate.mjs";

function goodEntry(overrides = {}) {
  return {
    id: "netflix",
    name: "Netflix",
    category: "Streaming",
    url: "https://netflix.com",
    description: "Ad-free movie & TV streaming",
    free_tier: false,
    headline_plan: "Standard",
    monthly_usd: 17.99,
    annual_usd: null,
    family_plan: false,
    different_household: "no",
    source_url: "https://help.netflix.com/x",
    last_verified: "2026-06-01",
    ...overrides,
  };
}

function goodDoc(services) {
  return { generated_at: "2026-06-01", services };
}

test("valid document has no errors", () => {
  assert.deepEqual(validate(goodDoc([goodEntry()])), []);
});

test("missing required field is reported", () => {
  const e = goodEntry();
  delete e.source_url;
  const errors = validate(goodDoc([e]));
  assert.ok(errors.some((m) => m.includes("source_url")));
});

test("duplicate ids are reported", () => {
  const errors = validate(goodDoc([goodEntry(), goodEntry()]));
  assert.ok(errors.some((m) => m.toLowerCase().includes("duplicate")));
});

test("unknown category is reported", () => {
  const errors = validate(goodDoc([goodEntry({ category: "Nonsense" })]));
  assert.ok(errors.some((m) => m.includes("category")));
});

test("non-kebab id is reported", () => {
  const errors = validate(goodDoc([goodEntry({ id: "Netflix_1" })]));
  assert.ok(errors.some((m) => m.includes("id")));
});

test("price must be number or null", () => {
  const errors = validate(goodDoc([goodEntry({ monthly_usd: "free" })]));
  assert.ok(errors.some((m) => m.includes("monthly_usd")));
});

test("bad date is reported", () => {
  const errors = validate(goodDoc([goodEntry({ last_verified: "06/01/2026" })]));
  assert.ok(errors.some((m) => m.includes("last_verified")));
});

test("bad url is reported", () => {
  const errors = validate(goodDoc([goodEntry({ url: "not a url" })]));
  assert.ok(errors.some((m) => m.includes("url")));
});

test("family_plan must be boolean", () => {
  const errors = validate(goodDoc([goodEntry({ family_plan: "yes" })]));
  assert.ok(errors.some((m) => m.includes("family_plan")));
});

test("different_household must be yes|no|unclear", () => {
  const errors = validate(goodDoc([goodEntry({ different_household: "maybe" })]));
  assert.ok(errors.some((m) => m.includes("different_household")));
});

test("missing different_household is reported", () => {
  const e = goodEntry();
  delete e.different_household;
  const errors = validate(goodDoc([e]));
  assert.ok(errors.some((m) => m.includes("different_household")));
});
