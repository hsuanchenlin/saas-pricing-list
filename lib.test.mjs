// lib.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatPrice,
  annualTotal,
  displayedPrice,
  savingsPercent,
  priceSortValue,
  filterServices,
  sortServices,
} from "./lib.mjs";

const SVC = {
  monthlyOnly: { id: "a", name: "Aaa", category: "Music", monthly_usd: 10, annual_usd: null },
  withAnnual: { id: "b", name: "Bbb", category: "AI", monthly_usd: 10, annual_usd: 96 },
  custom: { id: "c", name: "Ccc", category: "AI", monthly_usd: null, annual_usd: null },
};

test("formatPrice renders dollars or Custom", () => {
  assert.equal(formatPrice(17.99), "$17.99");
  assert.equal(formatPrice(10), "$10.00");
  assert.equal(formatPrice(null), "Custom");
});

test("annualTotal uses annual_usd, else monthly*12, else null", () => {
  assert.equal(annualTotal(SVC.withAnnual), 96);
  assert.equal(annualTotal(SVC.monthlyOnly), 120);
  assert.equal(annualTotal(SVC.custom), null);
});

test("displayedPrice respects mode", () => {
  assert.equal(displayedPrice(SVC.withAnnual, "monthly"), 10);
  assert.equal(displayedPrice(SVC.withAnnual, "annual"), 96);
  assert.equal(displayedPrice(SVC.monthlyOnly, "annual"), 120);
});

test("savingsPercent only when annual beats 12x monthly", () => {
  assert.equal(savingsPercent(SVC.withAnnual), 20); // 96 vs 120 -> 20%
  assert.equal(savingsPercent(SVC.monthlyOnly), null);
  assert.equal(savingsPercent(SVC.custom), null);
});

test("priceSortValue normalizes to a monthly-equivalent number, nulls last", () => {
  assert.equal(priceSortValue(SVC.withAnnual, "monthly"), 10);
  assert.equal(priceSortValue(SVC.withAnnual, "annual"), 8); // 96/12
  assert.equal(priceSortValue(SVC.custom, "monthly"), Infinity);
});

test("filterServices by query and category", () => {
  const list = [SVC.monthlyOnly, SVC.withAnnual, SVC.custom];
  assert.deepEqual(filterServices(list, { query: "bb", category: "" }).map(s => s.id), ["b"]);
  assert.deepEqual(filterServices(list, { query: "", category: "AI" }).map(s => s.id), ["b", "c"]);
  assert.deepEqual(filterServices(list, { query: "", category: "" }).length, 3);
});

test("sortServices by name and by price", () => {
  const list = [SVC.withAnnual, SVC.monthlyOnly, SVC.custom];
  assert.deepEqual(sortServices(list, "name", "asc", "monthly").map(s => s.id), ["a", "b", "c"]);
  assert.deepEqual(sortServices(list, "name", "desc", "monthly").map(s => s.id), ["c", "b", "a"]);
  // price asc, custom (Infinity) sorts last regardless of direction nulls? -> last on asc
  assert.deepEqual(sortServices(list, "price", "asc", "annual").map(s => s.id), ["b", "a", "c"]);
  // price desc: null-price (Custom) must still sort LAST, not first
  assert.deepEqual(sortServices(list, "price", "desc", "annual").map(s => s.id), ["a", "b", "c"]);
});
