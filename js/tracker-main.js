// js/tracker-main.js — entry point for tracker.html.
import { initAuth } from "./auth.js";
import {
  loadCatalog, populateServicePicker, listSubscriptions,
  addSubscription, deleteSubscription, renderRows,
} from "./subscriptions.js";

const signedOut = document.querySelector("#signed-out");
const signedIn = document.querySelector("#signed-in");
const who = document.querySelector("#who");
const rows = document.querySelector("#subs-rows");
const addMsg = document.querySelector("#add-msg");

async function refresh() {
  try {
    renderRows(rows, await listSubscriptions());
  } catch (e) {
    addMsg.textContent = `Could not load subscriptions: ${e.message}`;
  }
}

function showSignedIn(user) {
  signedOut.hidden = true;
  signedIn.hidden = false;
  who.textContent = `Signed in as ${user.email}`;
  refresh();
}
function showSignedOut() {
  signedIn.hidden = true;
  signedOut.hidden = false;
}

async function main() {
  await loadCatalog();
  populateServicePicker(document.querySelector("#service-list"));

  document.querySelector("#add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    addMsg.textContent = "";
    const { errors } = await addSubscription({
      service_name: document.querySelector("#f-service").value,
      start_date: document.querySelector("#f-start").value,
      end_date: document.querySelector("#f-end").value,
      reminder_days: Number(document.querySelector("#f-days").value),
    });
    if (errors.length) { addMsg.textContent = errors.join("; "); return; }
    e.target.reset();
    document.querySelector("#f-days").value = "3";
    refresh();
  });

  rows.addEventListener("click", async (e) => {
    const btn = e.target.closest("button.del");
    if (!btn) return;
    await deleteSubscription(btn.dataset.id);
    refresh();
  });

  initAuth({ onSignedIn: showSignedIn, onSignedOut: showSignedOut });
}

main();
