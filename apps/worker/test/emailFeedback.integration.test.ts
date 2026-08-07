import { env } from "cloudflare:workers";
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  getQueueResult,
  reset,
} from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, inject, it } from "vitest";

import {
  attachEmailProviderMessage,
  assertEmailProviderRecipientAvailable,
  backfillEmailProviderRoutes,
  prepareEmailProviderRoute,
  processEmailProviderDeadLetterBatch,
  processEmailProviderQueue,
} from "../src/communications/emailFeedback";

function requireBinding<T>(binding: T | undefined, name: string): T {
  if (binding === undefined) throw new Error(`The ${name} integration-test binding is missing.`);
  return binding;
}

const controlDatabase = requireBinding(env.CONTROL_DB, "CONTROL_DB");
const organizationStore = requireBinding(env.ORGANIZATION_STORE, "ORGANIZATION_STORE");

function bounceEvent(eventId: string, messageId: string, recipient: string) {
  return {
    metadata: { eventTimestamp: "2026-08-06T12:00:00.000Z" },
    payload: {
      bounce: { reason: "550 5.1.1 User unknown", type: "hard" },
      delivery: {
        smtpEnhancedStatusCode: "5.1.1",
        smtpResponse: "550 5.1.1 User unknown",
        smtpStatusCode: "550",
        status: "bounced",
      },
      eventId,
      messageId,
      recipient,
      sender: "auth@mail.staging.musicsite.org",
      subject: "Test",
      terminal: true,
    },
    source: { domain: "mail.staging.musicsite.org", type: "email.sending" },
    type: "cf.email.sending.message.bounced",
  };
}

function deferredEvent(eventId: string, messageId: string, recipient: string) {
  const event = bounceEvent(eventId, messageId, recipient);
  return {
    ...event,
    payload: {
      ...event.payload,
      bounce: { reason: "451 4.2.0 Temporary mailbox error", type: "soft" },
      delivery: {
        smtpEnhancedStatusCode: "4.2.0",
        smtpResponse: "451 4.2.0 Temporary mailbox error",
        smtpStatusCode: "451",
        status: "deferred",
      },
      terminal: false,
    },
    type: "cf.email.sending.message.deferred",
  };
}

function rejectedEvent(
  eventId: string,
  messageId: string,
  recipient: string,
  party: "sender" | "recipient",
  reason: string,
) {
  const event = bounceEvent(eventId, messageId, recipient);
  return {
    ...event,
    payload: {
      ...event.payload,
      bounce: undefined,
      delivery: { status: "rejected" },
      rejection: { detail: reason, party },
    },
    type: "cf.email.sending.message.rejected",
  };
}

beforeEach(async () => {
  await applyD1Migrations(controlDatabase, [...inject("controlMigrations")]);
});

afterEach(async () => {
  await reset();
});

describe("Email provider event queue", () => {
  it("exposes a normalized, actionable guard for active suppressions", async () => {
    await controlDatabase
      .prepare(
        `INSERT INTO email_recipient_suppressions
          (email_normalized, reason, source_event_id, provider_message_id, detail, active, created_at, updated_at)
         VALUES (?, 'bounce', ?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        "suppressed@example.test",
        "event-guard",
        "provider-guard",
        "Mailbox unavailable",
        "2026-08-06T12:00:00.000Z",
        "2026-08-06T12:00:00.000Z",
      )
      .run();

    await expect(
      assertEmailProviderRecipientAvailable(controlDatabase, " Suppressed@Example.Test "),
    ).rejects.toMatchObject({
      code: "email_recipient_suppressed",
      message:
        "This email address is on the application-wide email suppression list. Contact a Platform Administrator to review the suppression.",
      status: 409,
    });
  });

  it("rejects route reuse for a different recipient or Organization", async () => {
    const reserved = {
      destination: "reserved-owner@example.test",
      organizationId: "organization-owner",
      sourceId: "route-ownership",
      sourceKind: "platform_auth" as const,
    };
    await controlDatabase
      .prepare(
        `INSERT INTO organizations
          (id, name, slug, lifecycle_state, durable_object_key, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?, ?)`,
      )
      .bind(
        reserved.organizationId,
        "Organization owner",
        "organization-owner",
        reserved.organizationId,
        "2026-08-06T12:00:00.000Z",
        "2026-08-06T12:00:00.000Z",
      )
      .run();
    await prepareEmailProviderRoute(controlDatabase, reserved);
    await expect(
      prepareEmailProviderRoute(controlDatabase, {
        ...reserved,
        destination: "different-recipient@example.test",
      }),
    ).rejects.toThrow("another recipient");
    await expect(
      attachEmailProviderMessage(
        controlDatabase,
        { ...reserved, destination: "different-recipient@example.test" },
        "provider-message-ownership",
      ),
    ).rejects.toThrow("another recipient");
  });

  it("correlates, suppresses, and idempotently processes a provider event", async () => {
    const route = {
      destination: "bounced@example.test",
      organizationId: null,
      sourceId: "platform-route-1",
      sourceKind: "platform_auth" as const,
    };
    await prepareEmailProviderRoute(controlDatabase, route);
    await attachEmailProviderMessage(controlDatabase, route, "cf-message-1");
    const event = bounceEvent("cf-event-1", "cf-message-1", route.destination);
    const batch = createMessageBatch(env.EMAIL_EVENTS_QUEUE_NAME, [
      { attempts: 0, body: event, id: "queue-message-1", timestamp: new Date() },
    ]);
    await processEmailProviderQueue(batch, {
      CONTROL_DB: controlDatabase,
      ORGANIZATION_STORE: organizationStore,
    });
    await getQueueResult(batch, createExecutionContext());

    const processed = await controlDatabase
      .prepare("SELECT state FROM email_provider_events WHERE event_id = ?")
      .bind("cf-event-1")
      .first<{ readonly state: string }>();
    const suppression = await controlDatabase
      .prepare("SELECT active FROM email_recipient_suppressions WHERE email_normalized = ?")
      .bind(route.destination)
      .first<{ readonly active: number }>();
    expect(processed?.state).toBe("processed");
    expect(suppression?.active).toBe(1);

    const duplicateBatch = createMessageBatch(env.EMAIL_EVENTS_QUEUE_NAME, [
      { attempts: 0, body: event, id: "queue-message-duplicate", timestamp: new Date() },
    ]);
    await processEmailProviderQueue(duplicateBatch, {
      CONTROL_DB: controlDatabase,
      ORGANIZATION_STORE: organizationStore,
    });
    await getQueueResult(duplicateBatch, createExecutionContext());
    const eventCount = await controlDatabase
      .prepare("SELECT COUNT(*) AS count FROM email_provider_events WHERE event_id = ?")
      .bind("cf-event-1")
      .first<{ readonly count: number }>();
    expect(eventCount?.count).toBe(1);
  });

  it("keeps an event pending until its provider route is available", async () => {
    const batch = createMessageBatch(env.EMAIL_EVENTS_QUEUE_NAME, [
      {
        attempts: 0,
        body: bounceEvent("cf-event-pending", "cf-message-pending", "pending@example.test"),
        id: "queue-message-pending",
        timestamp: new Date(),
      },
    ]);
    await processEmailProviderQueue(batch, {
      CONTROL_DB: controlDatabase,
      ORGANIZATION_STORE: organizationStore,
    });
    await getQueueResult(batch, createExecutionContext());
    const pending = await controlDatabase
      .prepare(
        "SELECT state, last_error AS lastError FROM email_provider_events WHERE event_id = ?",
      )
      .bind("cf-event-pending")
      .first<{ readonly lastError: string; readonly state: string }>();
    expect(pending).toMatchObject({
      lastError: "provider_message_route_pending",
      state: "pending",
    });
  });

  it("completes route backfill across more than 1,000 Organizations", async () => {
    const createdAt = "2026-08-06T12:00:00.000Z";
    for (let offset = 0; offset < 1_001; offset += 100) {
      const statements = [];
      for (let index = offset; index < Math.min(offset + 100, 1_001); index += 1) {
        const id = `org-${String(index).padStart(4, "0")}`;
        statements.push(
          controlDatabase
            .prepare(
              `INSERT INTO organizations
                (id, name, slug, lifecycle_state, durable_object_key, created_at, updated_at)
               VALUES (?, ?, ?, 'active', ?, ?, ?)`,
            )
            .bind(id, id, id, id, createdAt, createdAt),
        );
      }
      await controlDatabase.batch(statements);
    }

    for (let page = 0; page < 11; page += 1) {
      await backfillEmailProviderRoutes(controlDatabase, (organizationId) =>
        Promise.resolve(Response.json({ nextOffset: null, organizationId, routes: [] })),
      );
    }

    const backfill = await controlDatabase
      .prepare(
        `SELECT completed_at AS completedAt, cursor_organization_id AS cursorOrganizationId
         FROM email_provider_route_backfill WHERE id = 1`,
      )
      .first<{
        readonly completedAt: string | null;
        readonly cursorOrganizationId: string | null;
      }>();
    expect(backfill?.completedAt).not.toBeNull();
    expect(backfill?.cursorOrganizationId).toBe("org-1000");
  });

  it("records deferred feedback without suppressing the recipient", async () => {
    const route = {
      destination: "deferred@example.test",
      organizationId: null,
      sourceId: "platform-route-deferred",
      sourceKind: "platform_auth" as const,
    };
    await prepareEmailProviderRoute(controlDatabase, route);
    await attachEmailProviderMessage(controlDatabase, route, "cf-message-deferred");
    const batch = createMessageBatch(env.EMAIL_EVENTS_QUEUE_NAME, [
      {
        attempts: 0,
        body: deferredEvent("cf-event-deferred", "cf-message-deferred", route.destination),
        id: "queue-message-deferred",
        timestamp: new Date(),
      },
    ]);
    await processEmailProviderQueue(batch, {
      CONTROL_DB: controlDatabase,
      ORGANIZATION_STORE: organizationStore,
    });
    await getQueueResult(batch, createExecutionContext());
    const suppression = await controlDatabase
      .prepare("SELECT active FROM email_recipient_suppressions WHERE email_normalized = ?")
      .bind(route.destination)
      .first<{ readonly active: number }>();
    const routeEvent = await controlDatabase
      .prepare(
        "SELECT event_type AS eventType, state FROM email_provider_events WHERE event_id = ?",
      )
      .bind("cf-event-deferred")
      .first<{ readonly eventType: string; readonly state: string }>();
    expect(suppression).toBeNull();
    expect(routeEvent).toEqual({ eventType: "deferred", state: "processed" });
  });

  it("keeps a recipient mismatch pending and does not suppress it", async () => {
    const route = {
      destination: "reserved@example.test",
      organizationId: null,
      sourceId: "platform-route-mismatch",
      sourceKind: "platform_auth" as const,
    };
    await prepareEmailProviderRoute(controlDatabase, route);
    await attachEmailProviderMessage(controlDatabase, route, "cf-message-mismatch");
    const batch = createMessageBatch(env.EMAIL_EVENTS_QUEUE_NAME, [
      {
        attempts: 0,
        body: bounceEvent("cf-event-mismatch", "cf-message-mismatch", "other@example.test"),
        id: "queue-message-mismatch",
        timestamp: new Date(),
      },
    ]);
    await processEmailProviderQueue(batch, {
      CONTROL_DB: controlDatabase,
      ORGANIZATION_STORE: organizationStore,
    });
    await getQueueResult(batch, createExecutionContext());
    const pending = await controlDatabase
      .prepare(
        "SELECT state, last_error AS lastError FROM email_provider_events WHERE event_id = ?",
      )
      .bind("cf-event-mismatch")
      .first<{ readonly lastError: string; readonly state: string }>();
    const suppression = await controlDatabase
      .prepare("SELECT active FROM email_recipient_suppressions WHERE email_normalized = ?")
      .bind("other@example.test")
      .first<{ readonly active: number }>();
    expect(pending?.state).toBe("pending");
    expect(pending?.lastError).toBe(
      "The provider event recipient did not match its reserved route.",
    );
    expect(suppression).toBeNull();
  });

  it("suppresses recipient-scoped rejections but not sender-scoped rejections", async () => {
    const recipientRoute = {
      destination: "rejected-recipient@example.test",
      organizationId: null,
      sourceId: "platform-route-rejected-recipient",
      sourceKind: "platform_auth" as const,
    };
    const senderRoute = {
      destination: "rejected-sender@example.test",
      organizationId: null,
      sourceId: "platform-route-rejected-sender",
      sourceKind: "platform_auth" as const,
    };
    await prepareEmailProviderRoute(controlDatabase, recipientRoute);
    await prepareEmailProviderRoute(controlDatabase, senderRoute);
    await attachEmailProviderMessage(
      controlDatabase,
      recipientRoute,
      "cf-message-rejected-recipient",
    );
    await attachEmailProviderMessage(controlDatabase, senderRoute, "cf-message-rejected-sender");
    const batch = createMessageBatch(env.EMAIL_EVENTS_QUEUE_NAME, [
      {
        attempts: 0,
        body: rejectedEvent(
          "cf-event-rejected-recipient",
          "cf-message-rejected-recipient",
          recipientRoute.destination,
          "recipient",
          "recipient mailbox blocked",
        ),
        id: "queue-message-rejected-recipient",
        timestamp: new Date(),
      },
      {
        attempts: 0,
        body: rejectedEvent(
          "cf-event-rejected-sender",
          "cf-message-rejected-sender",
          senderRoute.destination,
          "sender",
          "sender policy rejected",
        ),
        id: "queue-message-rejected-sender",
        timestamp: new Date(),
      },
    ]);
    await processEmailProviderQueue(batch, {
      CONTROL_DB: controlDatabase,
      ORGANIZATION_STORE: organizationStore,
    });
    await getQueueResult(batch, createExecutionContext());
    const rows = await controlDatabase
      .prepare(
        `SELECT email_normalized AS email, active
         FROM email_recipient_suppressions
         WHERE email_normalized IN (?, ?) ORDER BY email_normalized`,
      )
      .bind(recipientRoute.destination, senderRoute.destination)
      .all<{ readonly active: number; readonly email: string }>();
    expect(rows.results).toEqual([{ active: 1, email: recipientRoute.destination }]);
  });

  it("records malformed provider dead letters as acknowledge-only records", async () => {
    const batch = createMessageBatch(env.EMAIL_EVENTS_DLQ_NAME, [
      {
        attempts: 5,
        body: { malformed: true },
        id: "email-dead-letter-malformed",
        timestamp: new Date(),
      },
    ]);
    await processEmailProviderDeadLetterBatch(batch, { CONTROL_DB: controlDatabase });
    await getQueueResult(batch, createExecutionContext());
    await expect(
      controlDatabase
        .prepare(
          `SELECT event_id AS eventId, provider_message_id AS providerMessageId
           FROM email_feedback_dead_letters WHERE message_id = ?`,
        )
        .bind("email-dead-letter-malformed")
        .first(),
    ).resolves.toEqual({ eventId: null, providerMessageId: null });
  });
});
