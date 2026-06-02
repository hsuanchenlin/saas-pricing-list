// js/auth.js — magic-link sign in/out and session-state wiring.
import { supabase } from "./supabase-client.js";

// Wires the auth form and reports session changes via callbacks.
export function initAuth({ onSignedIn, onSignedOut }) {
  const form = document.querySelector("#signin-form");
  const emailInput = document.querySelector("#signin-email");
  const msg = document.querySelector("#auth-msg");
  const signoutBtn = document.querySelector("#signout");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "Sending…";
    const { error } = await supabase.auth.signInWithOtp({
      email: emailInput.value.trim(),
      options: { emailRedirectTo: window.location.href },
    });
    msg.textContent = error
      ? `Error: ${error.message}`
      : "Check your email for a sign-in link.";
  });

  signoutBtn.addEventListener("click", () => supabase.auth.signOut());

  supabase.auth.onAuthStateChange((_event, session) => {
    if (session?.user) onSignedIn(session.user);
    else onSignedOut();
  });
  supabase.auth.getSession().then(({ data }) => {
    if (data.session?.user) onSignedIn(data.session.user);
    else onSignedOut();
  });
}
