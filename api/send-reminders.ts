// api/send-reminders.ts — daily Vercel Cron target. Emails users before a renewal.
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { dueReminders } from "../lib/reminders.mjs";

export default async function handler(req: any, res: any) {
  // Only the Vercel Cron scheduler (which sends this header) may trigger sends.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SECRET_KEY as string
  );
  const resend = new Resend(process.env.RESEND_API_KEY as string);
  const from = process.env.REMINDER_FROM || "reminders@example.com";
  const today = new Date().toISOString().slice(0, 10);

  // Narrow in SQL (not yet reminded, not past), then filter precisely in JS.
  const { data: rows, error } = await supabase
    .from("subscriptions")
    .select("*")
    .is("reminded_at", null)
    .gte("end_date", today);
  if (error) return res.status(500).json({ error: error.message });

  const due = dueReminders(rows ?? [], today);
  let sent = 0;
  for (const r of due) {
    try {
      const { data: u } = await supabase.auth.admin.getUserById(r.user_id);
      const email = u?.user?.email;
      if (!email) continue;
      await resend.emails.send({
        from,
        to: email,
        subject: `Heads up: ${r.service_name} renews on ${r.end_date}`,
        text:
          `Your ${r.service_name} subscription renews on ${r.end_date}.\n` +
          `If you don't want to be charged again, cancel before then.`,
      });
      await supabase
        .from("subscriptions")
        .update({ reminded_at: new Date().toISOString() })
        .eq("id", r.id);
      sent++;
    } catch (e) {
      console.error(`reminder failed for ${r.id}:`, e);
    }
  }
  return res.status(200).json({ checked: rows?.length ?? 0, due: due.length, sent });
}
