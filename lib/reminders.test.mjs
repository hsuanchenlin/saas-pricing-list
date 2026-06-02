// lib/reminders.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDate, daysUntil, isReminderDue, dueReminders, validateSubscriptionInput,
} from "./reminders.mjs";

test("parseDate accepts ISO dates and rejects junk", () => {
  assert.ok(parseDate("2026-06-10") instanceof Date);
  assert.equal(parseDate("06/10/2026"), null);
  assert.equal(parseDate("nope"), null);
  assert.equal(parseDate(123), null);
});

test("daysUntil counts whole days, negative in the past", () => {
  assert.equal(daysUntil("2026-06-10", "2026-06-01"), 9);
  assert.equal(daysUntil("2026-06-01", "2026-06-01"), 0);
  assert.equal(daysUntil("2026-05-30", "2026-06-01"), -2);
  assert.equal(daysUntil("bad", "2026-06-01"), null);
});

test("isReminderDue fires only inside the window and only once", () => {
  const base = { endDate: "2026-06-10", reminderDays: 3, remindedAt: null };
  assert.equal(isReminderDue({ ...base, today: "2026-06-07" }), true);  // exactly 3 days before
  assert.equal(isReminderDue({ ...base, today: "2026-06-10" }), true);  // on the day
  assert.equal(isReminderDue({ ...base, today: "2026-06-06" }), false); // 4 days before
  assert.equal(isReminderDue({ ...base, today: "2026-06-11" }), false); // already past
  assert.equal(isReminderDue({ ...base, today: "2026-06-08", remindedAt: "2026-06-08T09:00:00Z" }), false);
});

test("dueReminders filters rows using each row's reminder_days", () => {
  const rows = [
    { id: "a", end_date: "2026-06-03", reminder_days: 3, reminded_at: null },
    { id: "b", end_date: "2026-06-20", reminder_days: 3, reminded_at: null },
    { id: "c", end_date: "2026-06-03", reminder_days: 3, reminded_at: "2026-06-01T00:00:00Z" },
  ];
  assert.deepEqual(dueReminders(rows, "2026-06-01").map((r) => r.id), ["a"]);
});

test("validateSubscriptionInput catches each bad field", () => {
  assert.deepEqual(validateSubscriptionInput({
    service_name: "Netflix", start_date: "2026-06-01", end_date: "2026-07-01", reminder_days: 3,
  }), []);
  assert.ok(validateSubscriptionInput({ service_name: " ", start_date: "2026-06-01", end_date: "2026-07-01", reminder_days: 3 })
    .some((m) => m.includes("service_name")));
  assert.ok(validateSubscriptionInput({ service_name: "X", start_date: "x", end_date: "2026-07-01", reminder_days: 3 })
    .some((m) => m.includes("start_date")));
  assert.ok(validateSubscriptionInput({ service_name: "X", start_date: "2026-07-02", end_date: "2026-07-01", reminder_days: 3 })
    .some((m) => m.includes("on or after")));
  assert.ok(validateSubscriptionInput({ service_name: "X", start_date: "2026-06-01", end_date: "2026-07-01", reminder_days: 99 })
    .some((m) => m.includes("reminder_days")));
});
