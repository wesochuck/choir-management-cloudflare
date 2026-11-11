import {
  communicationHistoryPageResponseSchema,
  communicationScheduledMessagesResponseSchema,
} from "@choir/contracts";
import { futureDateString } from "@choir/testkit";
import { reset, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import {
  listCommunicationHistoryFromStore,
  listCommunicationScheduledMessagesFromStore,
} from "../src/organization/communicationStore";
import { runOrganizationAlarm } from "../src/organization/scheduler";
import { readRosterAutomationConfiguration } from "../src/organization/statusAutomationStore";
import { provisionScheduler, requireBinding } from "./helpers/schedulerTestHarness";

afterEach(async () => {
  await reset();
});

describe("upcoming communication scheduling", () => {
  it("holds future jobs, wakes at their due time, and does not spin on a full future batch", async () => {
    const stub = await provisionScheduler();
    await runInDurableObject(stub, async (_instance, state) => {
      const now = new Date();
      const due = new Date(now.getTime() + 10 * 60_000);
      state.storage.sql.exec(
        "UPDATE scheduler_state SET next_due_at = ? WHERE singleton = 1",
        new Date(now.getTime() + 60 * 60_000).toISOString(),
      );
      for (let index = 0; index < 12; index++) {
        state.storage.sql.exec(
          "INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at) VALUES (?, 'audition_notification', ?, ?, ?)",
          crypto.randomUUID(),
          `future-notification:${String(index)}`,
          index === 0 ? due.toISOString() : new Date(now.getTime() + 86400000).toISOString(),
          now.toISOString(),
        );
      }
      const queue = requireBinding(env.JOBS_QUEUE, "JOBS_QUEUE");
      const before = await runOrganizationAlarm(state.storage, queue, now);
      expect(before.enqueuedJobCount).toBe(0);
      expect(await state.storage.getAlarm()).toBe(due.getTime());
      const atDue = await runOrganizationAlarm(state.storage, queue, due);
      expect(atDue.enqueuedJobCount).toBe(1);
      expect(
        state.storage.sql
          .exec<{ readonly count: number }>(
            "SELECT COUNT(*) AS count FROM scheduled_job_outbox WHERE enqueued_at IS NOT NULL",
          )
          .one().count,
      ).toBe(1);
      expect(await state.storage.getAlarm()).toBeGreaterThan(due.getTime() + 1000);
    });
  });

  it("projects tenant-local upcoming sends, paginates soonest first, follows edits, and never writes on read", async () => {
    const stub = await provisionScheduler();
    await runInDurableObject(stub, async (_instance, state) => {
      const now = new Date();
      const eventId = crypto.randomUUID();
      const startsAt = new Date(now.getTime() + 10 * 86400000).toISOString();
      state.storage.sql.exec(
        "INSERT INTO events (id, title, type, starts_at, created_at, updated_at) VALUES (?, 'Upcoming concert', 'Performance', ?, ?, ?)",
        eventId,
        startsAt,
        now.toISOString(),
        now.toISOString(),
      );
      const alarmBefore = await state.storage.getAlarm();
      const query = { organizationId: "organization-scheduler", status: "scheduled", limit: 1 };
      const first = communicationHistoryPageResponseSchema
        .omit({ requestId: true })
        .parse(await listCommunicationHistoryFromStore(state.storage, query).json());
      expect(first.items).toHaveLength(1);
      const item = first.items[0];
      expect(item).toMatchObject({
        kind: "automated",
        scheduledMessage: {
          kind: "event_reminder",
          projected: true,
          status: "Scheduled",
          eventId,
          scheduledAt: new Date(Date.parse(startsAt) - 48 * 3600000).toISOString(),
        },
      });
      const next = communicationHistoryPageResponseSchema.omit({ requestId: true }).parse(
        await listCommunicationHistoryFromStore(state.storage, {
          ...query,
          cursor: first.nextCursor,
        }).json(),
      );
      expect(next.items).toHaveLength(1);
      expect(next.items[0]).toMatchObject({ scheduledMessage: { kind: "attendance_report" } });
      expect(next.nextCursor).toBeNull();
      const fallback = communicationScheduledMessagesResponseSchema
        .omit({ requestId: true })
        .parse(
          await listCommunicationScheduledMessagesFromStore(
            state.storage,
            "organization-scheduler",
          ).json(),
        );
      expect(fallback.messages).toHaveLength(2);
      expect(await state.storage.getAlarm()).toBe(alarmBefore);
      expect(
        state.storage.sql
          .exec<{ readonly count: number }>("SELECT COUNT(*) AS count FROM scheduled_job_outbox")
          .one().count,
      ).toBe(0);
      const moved = new Date(Date.parse(startsAt) + 86400000).toISOString();
      state.storage.sql.exec("UPDATE events SET starts_at = ? WHERE id = ?", moved, eventId);
      const edited = communicationHistoryPageResponseSchema
        .omit({ requestId: true })
        .parse(await listCommunicationHistoryFromStore(state.storage, query).json());
      expect(edited.items[0]).toMatchObject({
        scheduledMessage: {
          id: item?.kind === "automated" ? item.scheduledMessage.id : "",
          scheduledAt: new Date(Date.parse(moved) - 48 * 3600000).toISOString(),
        },
      });
      state.storage.sql.exec(
        "INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at) VALUES (?, 'event_reminder', ?, ?, ?)",
        crypto.randomUUID(),
        `event-reminder:organization-scheduler:${eventId}`,
        now.toISOString(),
        now.toISOString(),
      );
      const materialized = communicationHistoryPageResponseSchema
        .omit({ requestId: true })
        .parse(
          await listCommunicationHistoryFromStore(state.storage, { ...query, limit: 100 }).json(),
        );
      expect(
        materialized.items.filter(
          (i) => i.kind === "automated" && i.scheduledMessage.kind === "event_reminder",
        ),
      ).toHaveLength(1);
      state.storage.sql.exec("UPDATE events SET is_canceled = 1 WHERE id = ?", eventId);
      const canceled = communicationHistoryPageResponseSchema
        .omit({ requestId: true })
        .parse(
          await listCommunicationHistoryFromStore(state.storage, { ...query, limit: 100 }).json(),
        );
      expect(
        canceled.items.some((i) => i.kind === "automated" && i.scheduledMessage.projected),
      ).toBe(false);
      expect(
        listCommunicationHistoryFromStore(state.storage, {
          ...query,
          organizationId: "another-organization",
        }).status,
      ).toBe(404);

      const rehearsalId = crypto.randomUUID();
      const rehearsalStartsAt = new Date(now.getTime() + 5 * 86400000).toISOString();
      state.storage.sql.exec(
        "INSERT INTO events (id, title, type, starts_at, created_at, updated_at) VALUES (?, 'Upcoming rehearsal', 'Rehearsal', ?, ?, ?)",
        rehearsalId,
        rehearsalStartsAt,
        now.toISOString(),
        now.toISOString(),
      );
      const rehearsalUpcoming = communicationScheduledMessagesResponseSchema
        .omit({ requestId: true })
        .parse(
          await listCommunicationScheduledMessagesFromStore(
            state.storage,
            "organization-scheduler",
          ).json(),
        );
      expect(
        rehearsalUpcoming.messages.some(
          (m) => m.eventId === rehearsalId && m.kind === "attendance_report",
        ),
      ).toBe(true);

      // Disable rehearsalAttendanceReportsEnabled and verify rehearsal attendance report disappears from projected
      const config = readRosterAutomationConfiguration(state.storage);
      state.storage.sql.exec(
        "UPDATE organization_metadata SET roster_configuration_json = ?",
        JSON.stringify({ ...config, rehearsalAttendanceReportsEnabled: false }),
      );
      const rehearsalUpcomingDisabled = communicationScheduledMessagesResponseSchema
        .omit({ requestId: true })
        .parse(
          await listCommunicationScheduledMessagesFromStore(
            state.storage,
            "organization-scheduler",
          ).json(),
        );
      expect(
        rehearsalUpcomingDisabled.messages.some(
          (m) => m.eventId === rehearsalId && m.kind === "attendance_report",
        ),
      ).toBe(false);

      // Clean up rehearsal event and restore config
      state.storage.sql.exec("DELETE FROM events WHERE id = ?", rehearsalId);
      state.storage.sql.exec(
        "UPDATE organization_metadata SET roster_configuration_json = ?",
        JSON.stringify({ ...config, rehearsalAttendanceReportsEnabled: true }),
      );
    });
  });

  it("shows future audition notifications as Scheduled in both endpoints, preserving processing and terminal states", async () => {
    const stub = await provisionScheduler();
    await runInDurableObject(stub, async (_instance, state) => {
      const now = new Date().toISOString();
      const dueAt = new Date(Date.now() + 86400000).toISOString();
      const auditionId = crypto.randomUUID();
      state.storage.sql.exec(
        "INSERT INTO auditions (id, name, email, created_at, updated_at) VALUES (?, 'Singer', 'singer@example.test', ?, ?)",
        auditionId,
        now,
        now,
      );
      const notificationId = crypto.randomUUID();
      state.storage.sql.exec(
        "INSERT INTO audition_notifications (id, audition_id, dedupe_key, kind, destination, recipient_name, subject, content_markdown, status, scheduled_for, created_at, updated_at) VALUES (?, ?, ?, 'audition_reminder', 'singer@example.test', 'Singer', 'Audition reminder', 'Reminder', 'queued', ?, ?, ?)",
        notificationId,
        auditionId,
        `audition-reminder:${auditionId}`,
        dueAt,
        now,
        now,
      );
      const jobId = crypto.randomUUID();
      state.storage.sql.exec(
        "INSERT INTO scheduled_job_outbox (job_id, kind, idempotency_key, due_at, created_at) VALUES (?, 'audition_notification', ?, ?, ?)",
        jobId,
        `audition-notification:${notificationId}`,
        dueAt,
        now,
      );
      const read = async () => {
        const history = communicationHistoryPageResponseSchema.omit({ requestId: true }).parse(
          await listCommunicationHistoryFromStore(state.storage, {
            organizationId: "organization-scheduler",
            status: "scheduled",
          }).json(),
        );
        const fallback = communicationScheduledMessagesResponseSchema
          .omit({ requestId: true })
          .parse(
            await listCommunicationScheduledMessagesFromStore(
              state.storage,
              "organization-scheduler",
            ).json(),
          );
        return { history, fallback };
      };
      const scheduled = await read();
      expect(scheduled.history.items).toHaveLength(1);
      expect(scheduled.fallback.messages[0]?.status).toBe("Scheduled");
      state.storage.sql.exec(
        "UPDATE scheduled_job_outbox SET enqueued_at = ? WHERE job_id = ?",
        now,
        jobId,
      );
      const queued = await read();
      expect(queued.history.items).toHaveLength(0);
      expect(queued.fallback.messages[0]?.status).toBe("Queued");
      state.storage.sql.exec(
        "UPDATE scheduled_job_outbox SET enqueued_at = NULL WHERE job_id = ?",
        jobId,
      );
      for (const status of ["processing", "sent", "failed", "suppressed"]) {
        state.storage.sql.exec(
          "UPDATE audition_notifications SET status = ? WHERE id = ?",
          status,
          notificationId,
        );
        const terminal = await read();
        expect(terminal.history.items).toHaveLength(0);
        expect(terminal.fallback.messages[0]?.status).toBe(
          status === "failed"
            ? "Failed"
            : status === "processing"
              ? "Queued"
              : status === "suppressed"
                ? "Skipped"
                : "Sent",
        );
      }
    });
  });

  it("groups ticket reminder previews before pagination while retaining a reminder job for every paid purchase", async () => {
    const stub = await provisionScheduler();
    await runInDurableObject(stub, async (_instance, state) => {
      const now = new Date();
      const startsAt = new Date(now.getTime() + 10 * 86400000).toISOString();
      const eventIds = [crypto.randomUUID(), crypto.randomUUID()];
      const paidPurchaseIds: string[] = [];
      for (const [eventIndex, eventId] of eventIds.entries()) {
        state.storage.sql.exec(
          "INSERT INTO events (id, title, type, starts_at, created_at, updated_at) VALUES (?, 'Ticket concert', 'Performance', ?, ?, ?)",
          eventId,
          startsAt,
          now.toISOString(),
          now.toISOString(),
        );
        const count = eventIndex === 0 ? 4 : 1;
        for (let index = 0; index < count; index++) {
          const purchaseId = crypto.randomUUID();
          const status = index === 3 ? "refunded" : "paid";
          if (status === "paid") paidPurchaseIds.push(purchaseId);
          state.storage.sql.exec(
            `INSERT INTO ticket_purchases (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
               buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents, currency,
               provider_session_id, provider_payment_id, status, created_at, updated_at)
             VALUES (?, ?, ?, 'Ticket concert', ?, 'UTC', 'Buyer', ?, 2, 100, 0, 200, 'usd', ?, '', ?, ?, ?)`,
            purchaseId,
            crypto.randomUUID(),
            eventId,
            startsAt,
            `buyer-${purchaseId}@example.test`,
            crypto.randomUUID(),
            status,
            now.toISOString(),
            now.toISOString(),
          );
        }
      }
      const alarmBefore = await state.storage.getAlarm();
      const previews: { readonly eventId: string | null; readonly recipientCount: number }[] = [];
      let cursor: string | null = null;
      for (let pageIndex = 0; pageIndex < 10; pageIndex++) {
        const page = communicationHistoryPageResponseSchema.omit({ requestId: true }).parse(
          await listCommunicationHistoryFromStore(state.storage, {
            organizationId: "organization-scheduler",
            status: "scheduled",
            limit: 1,
            cursor,
          }).json(),
        );
        for (const item of page.items) {
          if (item.kind === "automated" && item.scheduledMessage.kind === "ticket_reminder") {
            previews.push(item.scheduledMessage);
          }
        }
        cursor = page.nextCursor;
        if (!cursor) break;
      }
      expect(cursor).toBeNull();
      expect(previews).toHaveLength(2);
      expect(previews.find(({ eventId }) => eventId === eventIds[0])?.recipientCount).toBe(3);
      expect(previews.find(({ eventId }) => eventId === eventIds[1])?.recipientCount).toBe(1);
      const fallback = communicationScheduledMessagesResponseSchema
        .omit({ requestId: true })
        .parse(
          await listCommunicationScheduledMessagesFromStore(
            state.storage,
            "organization-scheduler",
          ).json(),
        );
      expect(fallback.messages.filter(({ kind }) => kind === "ticket_reminder")).toHaveLength(2);
      expect(await state.storage.getAlarm()).toBe(alarmBefore);
      const dueAt = new Date(Date.parse(startsAt) - 36 * 60 * 60 * 1000);
      await runOrganizationAlarm(
        state.storage,
        requireBinding(env.JOBS_QUEUE, "JOBS_QUEUE"),
        dueAt,
      );
      const notifications = state.storage.sql
        .exec<{ readonly purchaseId: string }>(
          "SELECT purchase_id AS purchaseId FROM ticket_notifications WHERE kind = 'reminder'",
        )
        .toArray();
      expect(notifications.map(({ purchaseId }) => purchaseId).sort()).toEqual(
        paidPurchaseIds.sort(),
      );
    });
  });

  it("previews paid ticket reminders and inherited RSVP follow-ups without duplicating persisted notifications", async () => {
    const stub = await provisionScheduler();
    await runInDurableObject(stub, async (_instance, state) => {
      const plan = state.storage.sql
        .exec<{ readonly detail: string }>(
          "EXPLAIN QUERY PLAN SELECT id FROM events INDEXED BY idx_events_active_rsvp_deadline WHERE type = 'Performance' AND is_archived = 0 AND is_canceled = 0 AND rsvp_deadline_date IS NOT NULL AND rsvp_deadline_date >= ? AND rsvp_deadline_date <= ? AND starts_at > ?",
          "2024-03-10",
          "2024-06-10",
          "2024-03-10T12:00:00Z",
        )
        .toArray();
      expect(
        plan.some(
          (row) =>
            row.detail.includes("SEARCH events") &&
            row.detail.includes("idx_events_active_rsvp_deadline"),
        ),
      ).toBe(true);
      const now = new Date().toISOString();
      const startsAt = new Date(Date.now() + 10 * 86400000).toISOString();
      const eventId = crypto.randomUUID();
      const purchaseId = crypto.randomUUID();
      state.storage.sql.exec(
        "INSERT INTO events (id, title, type, starts_at, rsvp_deadline_date, created_at, updated_at) VALUES (?, 'Ticket concert', 'Performance', ?, ?, ?, ?)",
        eventId,
        startsAt,
        futureDateString({ days: 7 }),
        now,
        now,
      );
      const configuration = readRosterAutomationConfiguration(state.storage);
      state.storage.sql.exec(
        "UPDATE organization_metadata SET roster_configuration_json = ?",
        JSON.stringify({
          ...configuration,
          rsvpExpiryEnabled: true,
          rsvpFollowUpEnabled: true,
          rsvpFollowUpLeadHours: 48,
        }),
      );
      state.storage.sql.exec(
        `INSERT INTO ticket_purchases (id, checkout_request_id, event_id, event_title, event_starts_at, event_timezone,
           buyer_name, buyer_email, quantity, unit_price_cents, fee_cents, amount_paid_cents, currency,
           provider_session_id, provider_payment_id, status, created_at, updated_at)
         VALUES (?, ?, ?, 'Ticket concert', ?, 'UTC', 'Buyer', 'buyer@example.test', 1, 100, 0, 100, 'usd', ?, '', 'paid', ?, ?)`,
        purchaseId,
        crypto.randomUUID(),
        eventId,
        startsAt,
        crypto.randomUUID(),
        now,
        now,
      );
      const query = { organizationId: "organization-scheduler", status: "scheduled", limit: 100 };
      const read = async () =>
        communicationHistoryPageResponseSchema
          .omit({ requestId: true })
          .parse(await listCommunicationHistoryFromStore(state.storage, query).json());
      const projected = await read();
      expect(projected.items[0]).toMatchObject({ scheduledMessage: { kind: "rsvp_follow_up" } });
      expect(
        projected.items.filter(
          (i) => i.kind === "automated" && i.scheduledMessage.kind === "ticket_reminder",
        ),
      ).toHaveLength(1);
      const id = crypto.randomUUID();
      const dueAt = new Date(Date.parse(startsAt) - 36 * 60 * 60 * 1000).toISOString();
      state.storage.sql.exec(
        `INSERT INTO ticket_notifications (id, purchase_id, event_id, dedupe_key, kind, destination, subject,
          content_markdown, status, scheduled_for, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'reminder', 'buyer@example.test', 'Ticket reminder', 'Reminder', 'queued', ?, ?, ?)`,
        id,
        purchaseId,
        eventId,
        `ticket-reminder:${purchaseId}:${eventId}:${startsAt}`,
        dueAt,
        now,
        now,
      );
      const persisted = await read();
      const ticketItems = persisted.items.filter(
        (i) => i.kind === "automated" && i.scheduledMessage.kind === "ticket_reminder",
      );
      expect(ticketItems).toHaveLength(1);
      expect(ticketItems[0]).toMatchObject({
        scheduledMessage: { id, projected: false, status: "Scheduled" },
      });
      const fallback = communicationScheduledMessagesResponseSchema
        .omit({ requestId: true })
        .parse(
          await listCommunicationScheduledMessagesFromStore(
            state.storage,
            "organization-scheduler",
          ).json(),
        );
      expect(fallback.messages.filter((i) => i.kind === "ticket_reminder")).toHaveLength(1);
      expect(fallback.messages.find((i) => i.kind === "ticket_reminder")?.status).toBe("Scheduled");
      state.storage.sql.exec(
        "UPDATE events SET rsvp_follow_up_mode = 'disabled' WHERE id = ?",
        eventId,
      );
      expect(
        (await read()).items.some(
          (i) => i.kind === "automated" && i.scheduledMessage.kind === "rsvp_follow_up",
        ),
      ).toBe(false);
      state.storage.sql.exec(
        "UPDATE events SET starts_at = ?, rsvp_follow_up_mode = 'inherit' WHERE id = ?",
        new Date(Date.now() + 180 * 86400000).toISOString(),
        eventId,
      );
      const distant = await read();
      expect(
        distant.items.some(
          (i) => i.kind === "automated" && i.scheduledMessage.kind === "rsvp_follow_up",
        ),
      ).toBe(true);
      expect(
        distant.items.some(
          (i) =>
            i.kind === "automated" &&
            i.scheduledMessage.projected &&
            i.scheduledMessage.kind === "event_reminder",
        ),
      ).toBe(false);
    });
  });
});
