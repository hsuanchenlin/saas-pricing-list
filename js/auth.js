// js/auth.js — GitHub OAuth sign in/out and session-state wiring.
import { supabase } from "./supabase-client.js";

// Wires the GitHub sign-in button and reports session changes via callbacks.
export function initAuth({ onSignedIn, onSignedOut }) {
  const githubBtn = document.querySelector("#signin-github");
  const msg = document.querySelector("#auth-msg");
  const signoutBtn = document.querySelector("#signout");

  githubBtn.addEventListener("click", async () => {
    msg.textContent = "Redirecting to GitHub…";
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: window.location.href },
    });
    if (error) msg.textContent = `Error: ${error.message}`;
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
