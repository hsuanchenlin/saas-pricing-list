// app.js — DOM rendering and event wiring. Pure logic lives in lib.mjs.
import {
  formatPrice, displayedPrice, savingsPercent, filterServices, sortServices,
} from "./lib.mjs";
import { CATEGORIES } from "./categories.mjs";

const state = { services: [], mode: "monthly", query: "", category: "", sort: { column: "name", dir: "asc" } };

const $ = (sel) => document.querySelector(sel);
const rowsEl = $("#rows");
const statusEl = $("#status");

function faviconUrl(serviceUrl) {
  try {
    const host = new URL(serviceUrl).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
  } catch { return ""; }
}

function render() {
  const filtered = filterServices(state.services, { query: state.query, category: state.category });
  const sorted = sortServices(filtered, state.sort.column, state.sort.dir, state.mode);

  rowsEl.innerHTML = "";
  for (const s of sorted) {
    const price = displayedPrice(s, state.mode);
    const save = state.mode === "annual" ? savingsPercent(s) : null;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="svc"><img alt="" loading="lazy" src="${faviconUrl(s.url)}" /><a href="${s.url}" target="_blank" rel="noopener">${s.name}</a></span></td>
      <td>${s.category}</td>
      <td>${s.headline_plan}</td>
      <td class="price">${formatPrice(price)}${save ? `<span class="save">save ${save}%</span>` : ""}</td>
      <td><span class="badge ${s.free_tier ? "yes" : ""}">${s.free_tier ? "Free tier" : "No"}</span></td>
      <td><a href="${s.source_url}" target="_blank" rel="noopener">source ↗</a></td>`;
    rowsEl.appendChild(tr);
  }
  statusEl.textContent = `${sorted.length} of ${state.services.length} services`;
}

function wireControls() {
  // Category dropdown options
  const sel = $("#category");
  for (const c of CATEGORIES) {
    const opt = document.createElement("option");
    opt.value = c; opt.textContent = c; sel.appendChild(opt);
  }

  $("#search").addEventListener("input", (e) => { state.query = e.target.value; render(); });
  sel.addEventListener("change", (e) => { state.category = e.target.value; render(); });

  for (const btn of document.querySelectorAll(".toggle button")) {
    btn.addEventListener("click", () => {
      state.mode = btn.dataset.mode;
      document.querySelectorAll(".toggle button").forEach((b) => b.classList.toggle("active", b === btn));
      render();
    });
  }

  for (const th of document.querySelectorAll("th.sortable")) {
    th.addEventListener("click", () => {
      const col = th.dataset.column;
      if (state.sort.column === col) {
        state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      } else {
        state.sort = { column: col, dir: "asc" };
      }
      document.querySelectorAll("th.sortable").forEach((h) => h.setAttribute("aria-sort", "none"));
      th.setAttribute("aria-sort", state.sort.dir === "asc" ? "ascending" : "descending");
      render();
    });
  }
}

async function init() {
  wireControls();
  try {
    const res = await fetch("data/services.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = await res.json();
    state.services = doc.services;
    $("#updated").textContent = `Prices last updated ${doc.generated_at}.`;
    render();
  } catch (err) {
    statusEl.textContent = "Could not load pricing data. Please try again later.";
    console.error(err);
  }
}

init();
