// lib/reminders.mjs — pure, dependency-free subscription/reminder logic.
// Shared by the tracker UI (js/subscriptions.js) and the reminder function
// (api/send-reminders.ts).

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;

// Parse an ISO date (YYYY-MM-DD) to a UTC-midnight Date, or null if invalid.
export function parseDate(s) {
  if (typeof s !== "string" || !ISO_DATE.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

// Whole days from `today` until `endDate` (negative if past). Both ISO strings.
export function daysUntil(endDate, today) {
  const e = parseDate(endDate), t = parseDate(today);
  if (!e || !t) return null;
  return Math.round((e - t) / DAY);
}

// True when a reminder should fire: not yet reminded and today is within
// [endDate - reminderDays, endDate].
export function isReminderDue({ endDate, reminderDays, today, remindedAt }) {
  if (remindedAt) return false;
  const d = daysUntil(endDate, today);
  if (d === null) return false;
  return d >= 0 && d <= reminderDays;
}

// Filter raw subscription rows down to those due for a reminder today.
export function dueReminders(rows, today) {
  return rows.filter((r) =>
    isReminderDue({
      endDate: r.end_date,
      reminderDays: r.reminder_days,
      today,
      remindedAt: r.reminded_at,
    })
  );
}

// Validate add/edit form input. Returns array of error strings ([] = valid).
export function validateSubscriptionInput({ service_name, start_date, end_date, reminder_days }) {
  const errors = [];
  if (typeof service_name !== "string" || service_name.trim() === "") {
    errors.push("service_name is required");
  }
  const start = parseDate(start_date);
  const end = parseDate(end_date);
  if (!start) errors.push("start_date must be a valid date (YYYY-MM-DD)");
  if (!end) errors.push("end_date must be a valid date (YYYY-MM-DD)");
  if (start && end && end < start) errors.push("end_date must be on or after start_date");
  if (!Number.isInteger(reminder_days) || reminder_days < 0 || reminder_days > 90) {
    errors.push("reminder_days must be an integer between 0 and 90");
  }
  return errors;
}
