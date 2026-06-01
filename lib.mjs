// lib.mjs — pure, DOM-free logic. Imported by both app.js and lib.test.mjs.

export function formatPrice(value) {
  if (value == null) return "Custom";
  return "$" + Number(value).toFixed(2);
}

export function annualTotal(service) {
  if (service.annual_usd != null) return service.annual_usd;
  if (service.monthly_usd != null) return service.monthly_usd * 12;
  return null;
}

export function displayedPrice(service, mode) {
  return mode === "annual" ? annualTotal(service) : service.monthly_usd;
}

export function savingsPercent(service) {
  const { monthly_usd, annual_usd } = service;
  if (monthly_usd == null || annual_usd == null) return null;
  const full = monthly_usd * 12;
  if (annual_usd >= full) return null;
  return Math.round((1 - annual_usd / full) * 100);
}

// Always returns a monthly-equivalent number so price sorting is consistent
// across the toggle. Missing prices sort last (Infinity).
export function priceSortValue(service, mode) {
  const total = annualTotal(service);
  if (total == null) return Infinity;
  return mode === "annual" ? total / 12 : (service.monthly_usd ?? Infinity);
}

export function filterServices(services, { query, category }) {
  const q = (query || "").trim().toLowerCase();
  return services.filter((s) => {
    const matchesQuery = !q || s.name.toLowerCase().includes(q);
    const matchesCategory = !category || s.category === category;
    return matchesQuery && matchesCategory;
  });
}

export function sortServices(services, column, dir, mode) {
  const factor = dir === "desc" ? -1 : 1;
  const copy = [...services];
  copy.sort((a, b) => {
    let av, bv;
    if (column === "price") {
      av = priceSortValue(a, mode);
      bv = priceSortValue(b, mode);
    } else {
      av = String(a[column] ?? "").toLowerCase();
      bv = String(b[column] ?? "").toLowerCase();
    }
    if (av < bv) return -1 * factor;
    if (av > bv) return 1 * factor;
    return 0;
  });
  return copy;
}
