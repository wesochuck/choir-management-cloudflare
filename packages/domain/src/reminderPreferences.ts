/**
 * Singer-owned automated event-reminder preferences.
 *
 * Each Organization profile independently opts in or out of routine reminder
 * emails per event category. The applicable preference is governed by the
 * actual event type of the reminder being sent — a linked Rehearsal honors
 * the rehearsal preference even when roster eligibility is inherited from its
 * parent Performance. Unknown or future event types (including Other Events
 * before dedicated support lands) fall under the other-event preference.
 */

export type EventReminderPreferenceKind = "rehearsal" | "performance" | "otherEvent";

export function eventReminderPreferenceKind(eventType: string): EventReminderPreferenceKind {
  if (eventType === "Rehearsal") return "rehearsal";
  if (eventType === "Performance") return "performance";
  return "otherEvent";
}
