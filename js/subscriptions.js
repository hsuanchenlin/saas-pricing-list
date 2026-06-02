// js/subscriptions.js — subscription CRUD, catalog picker, and row rendering.
import { supabase } from "./supabase-client.js";
import { daysUntil, validateSubscriptionInput } from "../lib/reminders.mjs";

let CATALOG = [];

export async function loadCatalog() {
  try {
    const res = await fetch("data/services.json");
    CATALOG = (await res.json()).services;
  } catch {
    CATALOG = [];
  }
}

export function populateServicePicker(listEl) {
  listEl.innerHTML = "";
  for (const s of CATALOG) {
    const opt = document.createElement("option");
    opt.value = s.name;
    listEl.appendChild(opt);
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export async function listSubscriptions() {
  const { data, error } = await supabase
    .from("subscriptions").select("*").order("end_date", { ascending: true });
  if (error) throw error;
  return data;
}

// Returns { errors: string[] }. Empty errors = inserted.
export async function addSubscription(input) {
  const errors = validateSubscriptionInput(input);
  if (errors.length) return { errors };
  const match = CATALOG.find((s) => s.name === input.service_name);
  const { error } = await supabase.from("subscriptions").insert({
    service_id: match ? match.id : null,
    service_name: input.service_name.trim(),
    start_date: input.start_date,
    end_date: input.end_date,
    reminder_days: input.reminder_days,
  });
  return { errors: error ? [error.message] : [] };
}

export async function deleteSubscription(id) {
  const { error } = await supabase.from("subscriptions").delete().eq("id", id);
  if (error) throw error;
}

export function renderRows(tbody, rows) {
  const today = todayIso();
  tbody.innerHTML = "";
  for (const r of rows) {
    const d = daysUntil(r.end_date, today);
    const soon = d !== null && d >= 0 && d <= r.reminder_days;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="svc-name"></td>
      <td>${r.start_date}</td>
      <td>${r.end_date}</td>
      <td>${r.reminder_days}d before</td>
      <td class="${soon ? "due" : ""}">${d === null ? "—" : d + " days"}</td>
      <td><button class="del" data-id="${r.id}">Delete</button></td>`;
    tr.querySelector(".svc-name").textContent = r.service_name;
    tbody.appendChild(tr);
  }
}
