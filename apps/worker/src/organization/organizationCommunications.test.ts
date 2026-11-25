import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { organizationEventSchema, type OrganizationEvent } from "@choir/contracts";
import { CommunicationRenderLimitError } from "@choir/domain";
import { futureDateString, futureIsoDate, pastIsoDate } from "@choir/testkit";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Env } from "../env";
import { communicationProblem } from "../routes/helpers/routeErrors";
import { handleTestEmailDelivery, renderTestEmailPayload } from "./organizationCommunications";

const EMAIL_FEEDBACK_MIGRATION_SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../control/migrations/0010_email_feedback.sql"),
  "utf8",
);

function setupEmailFeedbackD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = OFF;");
  db.exec(EMAIL_FEEDBACK_MIGRATION_SQL);
  const toBinding = (value: unknown): null | number | bigint | string | Uint8Array => {
    if (
      value === null ||
      value === undefined ||
      typeof value === "number" ||
      typeof value === "bigint" ||
      typeof value === "string" ||
      value instanceof Uint8Array
    ) {
      return value ?? null;
    }
    if (typeof value === "boolean") return value ? 1 : 0;
    throw new Error(`Unsupported SQLite binding type: ${typeof value}`);
  };
  const prepare = (query: string) => {
    let bindings: (null | number | bigint | string | Uint8Array)[] = [];
    const statement = {
      bind(...values: unknown[]) {
        bindings = values.map(toBinding);
        return statement;
      },
      first() {
        const row = db.prepare(query).get(...bindings);
        return Promise.resolve(row ?? null);
      },
      run() {
        const info = db.prepare(query).run(...bindings);
        return Promise.resolve({
          meta: {
            changes: Number(info.changes),
            last_row_id: Number(info.lastInsertRowid),
            rows_written: Number(info.changes),
          },
          results: [],
          success: true,
        });
      },
    };
    return statement;
  };
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test-only SQLite-backed D1 adapter
  return { prepare } as unknown as D1Database;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeEvent(overrides: Partial<OrganizationEvent> = {}) {
  return organizationEventSchema.parse({
    advancePriceCents: 0,
    callTime: "17:30",
    createdAt: pastIsoDate({ days: 5 }),
    dayOfPriceCents: 0,
    details: "Concert details",
    doorsOpenTime: "",
    durationMinutes: 90,
    id: "11111111-1111-4111-8111-111111111111",
    isCanceled: false,
    isTicketingEnabled: false,
    location: "Main Hall",
    parentPerformanceId: null,
    publicDetails: "",
    publicGraphicFileId: null,
    publishOnWebsite: false,
    rsvpDeadlineDate: futureDateString({ days: 5 }),
    rsvpFollowUpLeadHours: null,
    rsvpFollowUpMode: "inherit",
    setList: [],
    setListApproved: false,
    setListDefaultTransitionSeconds: 0,
    startsAt: futureIsoDate({ days: 10 }),
    ticketCapacity: null,
    title: "Downtown Christmas Stroll",
    type: "Performance",
    updatedAt: pastIsoDate({ days: 1 }),
    venueId: null,
    ...overrides,
  });
}

describe("renderTestEmailPayload", () => {
  it("resolves {setlist} as a bulleted Markdown list when the event has set list items", () => {
    const rendered = renderTestEmailPayload({
      baseDomain: "alpha.localhost",
      branding: { logoFileId: null, organizationName: "Alpha Choir" },
      contentMarkdown: "### Set list\n\n{setlist}\n\n{{PLAYER_LINK}}",
      event: makeEvent({
        setList: [
          { title: "Adeste Fideles" },
          { title: "God Rest You Merry, Gentlemen" },
          { title: "A King is Born" },
        ],
      }),
      fromName: "Alpha Choir",
      subject: "Performance details for: {eventTitle}",
      timezone: "America/New_York",
    });

    expect(rendered.templatedSubject).toBe("Performance details for: Downtown Christmas Stroll");
    expect(rendered.templatedContent).toContain(
      "### Set list\n\n- Adeste Fideles\n- God Rest You Merry, Gentlemen\n- A King is Born",
    );
    expect(rendered.templatedContent).not.toContain("{setlist}");
  });

  it("resolves {setlist} to the empty fallback when the selected event has no set list items", () => {
    const rendered = renderTestEmailPayload({
      baseDomain: "alpha.localhost",
      branding: { logoFileId: null, organizationName: "Alpha Choir" },
      contentMarkdown: "### Set list\n\n{setlist}",
      event: makeEvent({ setList: [] }),
      fromName: "Alpha Choir",
      subject: "Performance details for: {eventTitle}",
      timezone: "America/New_York",
    });

    expect(rendered.templatedContent).toContain("- Set list not published");
    expect(rendered.templatedContent).not.toContain("{setlist}");
  });

  it("leaves {setlist} unresolved when no event is selected", () => {
    const rendered = renderTestEmailPayload({
      baseDomain: "alpha.localhost",
      branding: { logoFileId: null, organizationName: "Alpha Choir" },
      contentMarkdown: "### Set list\n\n{setlist}",
      event: null,
      fromName: "Alpha Choir",
      subject: "General update",
      timezone: "America/New_York",
    });

    expect(rendered.templatedContent).toContain("{setlist}");
  });

  it("formats {eventCallTime} as 12-hour AM/PM and resolves {eventLocation} with venue address and Google Maps link", () => {
    const rendered = renderTestEmailPayload({
      baseDomain: "alpha.localhost",
      branding: { logoFileId: null, organizationName: "Alpha Choir" },
      contentMarkdown: "- **Call time:** {eventCallTime}\n- **Location:** {eventLocation}",
      event: makeEvent({
        callTime: "17:30",
        location: "",
        venueId: "22222222-2222-4222-8222-222222222222",
      }),
      fromName: "Alpha Choir",
      subject: "Performance details for: {eventTitle} at {eventLocation}",
      timezone: "America/New_York",
      venueAddress: "163 E Wheeling St, Lancaster, OH 43130",
      venueName: "First United Methodist Church - Sanctuary Main Floor",
    });

    expect(rendered.templatedContent).toContain("- **Call time:** 5:30 PM");
    expect(rendered.templatedContent).toContain(
      "- **Location:** First United Methodist Church - Sanctuary Main Floor, 163 E Wheeling St, Lancaster, OH 43130 ([Google Maps](https://www.google.com/maps/search/?api=1&query=First%20United%20Methodist%20Church%20-%20Sanctuary%20Main%20Floor%2C%20163%20E%20Wheeling%20St%2C%20Lancaster%2C%20OH%2043130))",
    );
    expect(rendered.templatedSubject).toBe(
      "Performance details for: Downtown Christmas Stroll at First United Methodist Church - Sanctuary Main Floor, 163 E Wheeling St, Lancaster, OH 43130",
    );
  });

  it("enforces exact-limit and +1 budgets on body, subject, and generated links (SEC-01)", () => {
    const event = makeEvent({
      setList: [{ title: "Song One" }, { title: "Song Two" }],
      title: "Spring Gala",
    });
    const baseline = renderTestEmailPayload({
      baseDomain: "alpha.localhost",
      branding: { logoFileId: null, organizationName: "Alpha Choir" },
      contentMarkdown: "{setlist}\n{{RSVP_LINKS}}\n{{PLAYER_LINK}}",
      event,
      fromName: "Alpha Choir",
      subject: "Details: {eventTitle}",
      timezone: "America/New_York",
    });

    const exact = renderTestEmailPayload({
      baseDomain: "alpha.localhost",
      branding: { logoFileId: null, organizationName: "Alpha Choir" },
      contentMarkdown: "{setlist}\n{{RSVP_LINKS}}\n{{PLAYER_LINK}}",
      event,
      fromName: "Alpha Choir",
      renderLimits: {
        body: baseline.templatedContent.length,
        subject: baseline.templatedSubject.length,
      },
      subject: "Details: {eventTitle}",
      timezone: "America/New_York",
    });
    expect(exact.templatedContent).toBe(baseline.templatedContent);
    expect(exact.templatedSubject).toBe(baseline.templatedSubject);

    expect(() =>
      renderTestEmailPayload({
        baseDomain: "alpha.localhost",
        branding: { logoFileId: null, organizationName: "Alpha Choir" },
        contentMarkdown: "{setlist}\n{{RSVP_LINKS}}\n{{PLAYER_LINK}}!",
        event,
        fromName: "Alpha Choir",
        renderLimits: {
          body: baseline.templatedContent.length,
          subject: baseline.templatedSubject.length,
        },
        subject: "Details: {eventTitle}",
        timezone: "America/New_York",
      }),
    ).toThrow(CommunicationRenderLimitError);

    expect(() =>
      renderTestEmailPayload({
        baseDomain: "alpha.localhost",
        branding: { logoFileId: null, organizationName: "Alpha Choir" },
        contentMarkdown: "{setlist}\n{{RSVP_LINKS}}\n{{PLAYER_LINK}}",
        event,
        fromName: "Alpha Choir",
        renderLimits: {
          body: baseline.templatedContent.length,
          subject: baseline.templatedSubject.length,
        },
        subject: "Details: {eventTitle}!",
        timezone: "America/New_York",
      }),
    ).toThrow(CommunicationRenderLimitError);
  });
});

function createTestEmailDeliveryEnv(
  event: OrganizationEvent,
  sendEmailMock: ReturnType<typeof vi.fn>,
  venues: readonly {
    readonly address: string;
    readonly createdAt: string;
    readonly id: string;
    readonly name: string;
    readonly updatedAt: string;
  }[] = [],
): Env {
  const stub = {
    calendarRpc(call: { readonly path: string }) {
      if (call.path === "/internal/calendar/events") {
        return Promise.resolve({
          headers: {},
          ok: true as const,
          status: 200,
          value: { events: [event] },
        });
      }
      if (call.path === "/internal/calendar/venues") {
        return Promise.resolve({
          headers: {},
          ok: true as const,
          status: 200,
          value: { venues },
        });
      }
      if (call.path === "/internal/calendar/settings") {
        return Promise.resolve({
          headers: {},
          ok: true as const,
          status: 200,
          value: {
            attendanceGraceMinutes: 15,
            defaultEventDurationMinutes: 90,
            defaultRsvpFollowUpLeadHours: 24,
            defaultRsvpLeadDays: 7,
            organizationId: "org-alpha",
            timezone: "America/New_York",
          },
        });
      }
      throw new Error(`Unexpected calendarRpc path: ${call.path}`);
    },
    communicationRpc(call: { readonly path: string }) {
      if (call.path === "/internal/email-settings") {
        return Promise.resolve({
          headers: {},
          ok: true as const,
          status: 200,
          value: {
            settings: {
              fromName: "Alpha Choir",
              replyToEmail: null,
            },
          },
        });
      }
      throw new Error(`Unexpected communicationRpc path: ${call.path}`);
    },
    contentRpc(call: { readonly path: string }) {
      if (call.path === "/internal/branding") {
        return Promise.resolve({
          headers: {},
          ok: true as const,
          status: 200,
          value: {
            logoFileId: null,
            organizationId: "org-alpha",
            organizationName: "Alpha Choir",
            physicalAddress: "123 Choir Way, Seattle, WA 98101",
          },
        });
      }
      throw new Error(`Unexpected contentRpc path: ${call.path}`);
    },
    readUpcomingPerformancesContext() {
      return Promise.resolve({
        performances: [
          {
            id: event.id,
            isTicketingEnabled: true,
            location: event.location,
            publishOnWebsite: true,
            startsAt: event.startsAt,
            title: event.title,
            type: "Performance" as const,
          },
        ],
        timezone: "America/New_York",
      });
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- test-only mock environment
  return {
    APP_ENV: "staging",
    BREVO_API_KEY: "brevo-test-key",
    CONTROL_DB: setupEmailFeedbackD1(),
    EXTERNAL_EFFECTS_MODE: "sandbox",
    ORGANIZATION_STORE: {
      getByName: () => stub,
    },
    PLATFORM_EMAIL: {
      send: sendEmailMock,
    },
    PLATFORM_EMAIL_FROM: "noreply@example.test",
    PLATFORM_EMAIL_MODE: "sandbox",
    PRODUCT_BASE_DOMAIN: "alpha.localhost",
  } as unknown as Env;
}

describe("handleTestEmailDelivery render budget enforcement (SEC-01)", () => {
  it("carries body and subject budgets through link substitutions with zero provider calls on overflow", async () => {
    const sendEmailMock = vi.fn().mockResolvedValue({ messageId: "msg-123" });

    const event = makeEvent({
      isTicketingEnabled: true,
      publishOnWebsite: true,
      setList: [{ title: "Adeste Fideles" }],
      title: "Winter Concert",
    });
    const env = createTestEmailDeliveryEnv(event, sendEmailMock);
    const origin = "https://alpha.localhost";
    const expectedTicketLink = `[View event details and buy tickets](${origin}/tickets/${event.id})`;
    const bodyTemplate = "{setlist}\n{{EVENT_TICKET_LINK}}";
    const expectedBodyLength = `- Adeste Fideles\n${expectedTicketLink}`.length;
    const subjectTemplate = "Update: {eventTitle}";
    const expectedSubjectLength = "Update: Winter Concert".length;

    // Exact-limit body & subject succeed and deliver once.
    await handleTestEmailDelivery(
      env,
      "org-alpha",
      {
        contentMarkdown: bodyTemplate,
        email: "director@example.test",
        eventId: event.id,
        subject: subjectTemplate,
      },
      origin,
      undefined,
      { body: expectedBodyLength, subject: expectedSubjectLength },
    );
    expect(sendEmailMock).toHaveBeenCalledTimes(1);

    // One extra character in body (after generated link substitution) fails with validation error and zero provider calls.
    sendEmailMock.mockClear();
    try {
      await handleTestEmailDelivery(
        env,
        "org-alpha",
        {
          contentMarkdown: `${bodyTemplate}!`,
          email: "director@example.test",
          eventId: event.id,
          subject: subjectTemplate,
        },
        origin,
        undefined,
        { body: expectedBodyLength, subject: expectedSubjectLength },
      );
      expect.unreachable("Expected body render limit error");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(CommunicationRenderLimitError);
      const problem = communicationProblem(error, "req-body-over", "fallback");
      expect(problem.status).toBe(400);
      expect(problem.problem.code).toBe("communication_render_limit_exceeded");
    }
    expect(sendEmailMock).not.toHaveBeenCalled();

    // One extra character in subject fails with validation error and zero provider calls.
    try {
      await handleTestEmailDelivery(
        env,
        "org-alpha",
        {
          contentMarkdown: bodyTemplate,
          email: "director@example.test",
          eventId: event.id,
          subject: `${subjectTemplate}!`,
        },
        origin,
        undefined,
        { body: expectedBodyLength, subject: expectedSubjectLength },
      );
      expect.unreachable("Expected subject render limit error");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(CommunicationRenderLimitError);
      const problem = communicationProblem(error, "req-subject-over", "fallback");
      expect(problem.status).toBe(400);
      expect(problem.problem.code).toBe("communication_render_limit_exceeded");
    }
    expect(sendEmailMock).not.toHaveBeenCalled();

    // Upcoming performances link expansion also respects the body budget and makes zero provider calls on overflow.
    try {
      await handleTestEmailDelivery(
        env,
        "org-alpha",
        {
          contentMarkdown: "{{UPCOMING_PERFORMANCES}}",
          email: "director@example.test",
          eventId: event.id,
          subject: subjectTemplate,
        },
        origin,
        undefined,
        { body: 20, subject: expectedSubjectLength },
      );
      expect.unreachable("Expected upcoming performances body render limit error");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(CommunicationRenderLimitError);
      const problem = communicationProblem(error, "req-upcoming-over", "fallback");
      expect(problem.status).toBe(400);
      expect(problem.problem.code).toBe("communication_render_limit_exceeded");
    }
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("resolves the event venue name and 12-hour call time in delivered test emails", async () => {
    const sendEmailMock = vi.fn().mockResolvedValue({ messageId: "msg-venue-1" });
    const venueId = "22222222-2222-4222-8222-222222222222";
    const event = makeEvent({
      callTime: "17:30",
      location: "",
      venueId,
    });
    const env = createTestEmailDeliveryEnv(event, sendEmailMock, [
      {
        address: "100 Main St",
        createdAt: pastIsoDate({ days: 30 }),
        id: venueId,
        name: "First United Methodist Church - Sanctuary Main Floor",
        updatedAt: pastIsoDate({ days: 10 }),
      },
    ]);

    await handleTestEmailDelivery(
      env,
      "org-alpha",
      {
        contentMarkdown: "- **Call time:** {eventCallTime}\n- **Location:** {eventLocation}",
        email: "director@example.test",
        eventId: event.id,
        subject: "Performance details for: {eventTitle}",
      },
      "https://alpha.localhost",
    );

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining("5:30 PM"),
      }),
    );
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining(
          "First United Methodist Church - Sanctuary Main Floor, 100 Main St",
        ),
      }),
    );
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining(
          'href="https://www.google.com/maps/search/?api=1&amp;query=First%20United%20Methodist%20Church%20-%20Sanctuary%20Main%20Floor%2C%20100%20Main%20St"',
        ),
      }),
    );
    expect(sendEmailMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining("17:30"),
      }),
    );
  });

  it("places (No login required.) on the right side of RSVP and player buttons in test emails", async () => {
    const sentPayloads: { readonly html: string; readonly text: string }[] = [];
    const sendEmailMock = vi.fn((payload: { readonly html: string; readonly text: string }) => {
      sentPayloads.push(payload);
      return Promise.resolve({ messageId: "test-msg-2" });
    });
    const event = makeEvent();
    const env = createTestEmailDeliveryEnv(event, sendEmailMock);

    await handleTestEmailDelivery(
      env,
      "org-alpha",
      {
        contentMarkdown: "{{RSVP_LINKS}}\n\n{{PLAYER_LINK}}",
        email: "director@example.test",
        eventId: event.id,
        subject: "Details: {eventTitle}",
      },
      "https://alpha.localhost",
    );

    expect(sentPayloads).toHaveLength(1);
    const sent = sentPayloads[0];
    expect(sent?.html).toMatch(
      />Open RSVP page<\/a>\s*<\/td>\s*<td [^>]*>\(No login required\.\)<\/td>/,
    );
    expect(sent?.html).toMatch(
      />Open practice player<\/a>\s*<\/td>\s*<td [^>]*>\(No login required\.\)<\/td>/,
    );
    expect(sent?.html).not.toContain(
      '<p style="color:#30343b;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:25px;margin:0 0 18px;">(No login required.)</p>',
    );
    expect(sent?.text).toContain(
      "Open RSVP page: https://alpha.localhost/rsvp?sample=1 (No login required.)",
    );
    expect(sent?.text).toContain(
      "Open practice player: https://alpha.localhost/player?sample=1 (No login required.)",
    );
  });
});
