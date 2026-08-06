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
  prepareEmailProviderRoute,
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
});
