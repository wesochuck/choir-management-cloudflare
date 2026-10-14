import {
  communicationDeleteResponseSchema,
  communicationMessageResponseSchema,
  communicationTemplateResponseSchema,
  communicationTemplatesResponseSchema,
} from "@choir/contracts";
import { exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OrganizationStore } from "../src/organization/OrganizationStore";
import {
  readTicketMessageTemplate,
  ticketMessageTemplates,
} from "../src/organization/ticketMessageTemplates";
import {
  setupOrganizationIntegration,
  teardownOrganizationIntegration,
} from "./organization.integration.fixture";
import {
  api,
  database,
  managerEmail,
  signIn,
  stores,
  write,
} from "./communications.integration.fixture";

beforeEach(async () => {
  await setupOrganizationIntegration(database, stores, {
    displayName: "Communications Manager",
    email: managerEmail,
    organizations: [
      { id: "organization-alpha", role: "admin", slug: "alpha" },
      { id: "organization-bravo", role: "member", slug: "bravo" },
    ],
    userId: "communications-manager",
  });
});

afterEach(async () => teardownOrganizationIntegration());

describe("Organization communications drafts and templates", () => {
  it("saves drafts without queueing work and rejects invalid or unreachable sends", async () => {
    const cookie = await signIn();
    const audience = {
      eventId: null,
      globalStatuses: ["Active"],
      profileIds: [],
      rsvp: "All",
      voiceParts: [],
    };
    const draftResponse = await write(
      "alpha.localhost",
      "/api/organization/communications/drafts",
      cookie,
      { audience, channel: "SMS", contentMarkdown: "", subject: "" },
    );
    expect(draftResponse.status).toBe(201);
    const draft = communicationMessageResponseSchema.parse(await draftResponse.json());
    expect(draft.status).toBe("Draft");
    const outboxCount = await runInDurableObject<OrganizationStore, number>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<Record<string, SqlStorageValue> & { count: number }>(
            "SELECT COUNT(*) AS count FROM scheduled_job_outbox",
          )
          .one().count,
    );
    expect(outboxCount).toBe(0);
    const template = communicationTemplateResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/templates", cookie, {
          channel: "SMS",
          contentMarkdown: "Hello {singerName}",
          subject: "",
          title: "Welcome",
        })
      ).json(),
    );
    const templates = communicationTemplatesResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/communications/templates", cookie),
        )
      ).json(),
    );
    expect(templates.templates.map(({ title }) => title).sort()).toEqual([
      "Attendance Report",
      "Audition Confirmed",
      "Audition Reminder",
      "Audition Submission Thanks",
      "Bundle Ticket Confirmation",
      "Bundle Ticket Refund Confirmation",
      "Donation Payment Receipt",
      "Dues Payment Notice",
      "Dues Payment Receipt",
      "Event RSVP Follow-up",
      "Event RSVP Invitation",
      "General Announcement",
      "Performance Reminder",
      "Rehearsal Reminder",
      "Ticket Concert Reminder",
      "Ticket Confirmation",
      "Ticket Refund Confirmation",
      "Weather / Schedule Delay Alert",
      "Welcome",
    ]);
    expect(
      templates.templates
        .filter(({ isSystem }) => isSystem)
        .map(({ title }) => title)
        .sort(),
    ).toEqual([
      "Attendance Report",
      "Audition Confirmed",
      "Audition Reminder",
      "Audition Submission Thanks",
      "Bundle Ticket Confirmation",
      "Bundle Ticket Refund Confirmation",
      "Donation Payment Receipt",
      "Dues Payment Notice",
      "Dues Payment Receipt",
      "Event RSVP Follow-up",
      "Event RSVP Invitation",
      "General Announcement",
      "Performance Reminder",
      "Rehearsal Reminder",
      "Ticket Concert Reminder",
      "Ticket Confirmation",
      "Ticket Refund Confirmation",
      "Weather / Schedule Delay Alert",
    ]);
    const systemEmailTemplates = templates.templates.filter(
      ({ channel, isSystem }) => isSystem && channel === "Email",
    );
    expect(systemEmailTemplates).toHaveLength(17);
    for (const systemTemplate of systemEmailTemplates) {
      expect(systemTemplate.contentMarkdown, systemTemplate.title).toMatch(/^## |\n## /);
      expect(systemTemplate.subject, systemTemplate.title).not.toMatch(/^[A-Z\s!]+:/);
    }
    expect(
      templates.templates.find(({ title }) => title === "Audition Submission Thanks"),
    ).toMatchObject({ channel: "Email", isSystem: true });
    const ticketTemplate = templates.templates.find(({ title }) => title === "Ticket Confirmation");
    expect(ticketTemplate?.isSystem).toBe(true);
    const updatedTicketTemplate = communicationTemplateResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/communications/templates/${ticketTemplate?.id ?? ""}`,
            cookie,
            {
              body: JSON.stringify({
                channel: "Email",
                contentMarkdown: "Custom ticket wording for {singerName} {{TICKET_LINK}}",
                subject: "Custom ticket subject for {eventTitle}",
                title: "Ticket Confirmation",
              }),
              headers: { "content-type": "application/json" },
              method: "PUT",
            },
          ),
        )
      ).json(),
    );
    expect(updatedTicketTemplate).toMatchObject({
      contentMarkdown: "Custom ticket wording for {singerName} {{TICKET_LINK}}",
      isSystem: true,
      subject: "Custom ticket subject for {eventTitle}",
    });
    expect(
      communicationDeleteResponseSchema.parse(
        await (
          await exports.default.fetch(
            api(
              "alpha.localhost",
              `/api/organization/communications/templates/${template.id}`,
              cookie,
              { method: "DELETE" },
            ),
          )
        ).json(),
      ).status,
    ).toBe("deleted");
    expect(
      communicationDeleteResponseSchema.parse(
        await (
          await exports.default.fetch(
            api("alpha.localhost", `/api/organization/communications/drafts/${draft.id}`, cookie, {
              method: "DELETE",
            }),
          )
        ).json(),
      ).status,
    ).toBe("deleted");
    expect(
      (
        await write("alpha.localhost", "/api/organization/communications/send", cookie, {
          audience,
          channel: "Email",
          contentMarkdown: "Missing subject",
          subject: "",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await write("alpha.localhost", "/api/organization/communications/send", cookie, {
          audience,
          channel: "SMS",
          contentMarkdown: "Nobody can receive this",
          subject: "",
        })
      ).status,
    ).toBe(409);

    // Validation rule: mixed audience with member-only placeholder is rejected on send
    const invalidContextSendResponse = await write(
      "alpha.localhost",
      "/api/organization/communications/send",
      cookie,
      {
        audience: { ...audience, targetAudiences: ["Members", "Ticket Buyers"] },
        channel: "Email",
        contentMarkdown: "Please RSVP: {{RSVP_LINKS}}",
        subject: "Mixed Audience Notice",
      },
    );
    expect(invalidContextSendResponse.status).toBe(400);
    expect(await invalidContextSendResponse.json()).toMatchObject({
      code: "invalid_communication_context",
    });

    // Saving a draft with conflicting placeholders remains allowed
    const draftWithConflictResponse = await write(
      "alpha.localhost",
      "/api/organization/communications/drafts",
      cookie,
      {
        audience: { ...audience, targetAudiences: ["Members", "Ticket Buyers"] },
        channel: "Email",
        contentMarkdown: "Please RSVP: {{RSVP_LINKS}}",
        subject: "Draft with conflict",
      },
    );
    expect(draftWithConflictResponse.status).toBe(201);
  });

  it("resets only registered system templates to the current canonical default", async () => {
    const cookie = await signIn();
    const initialTemplates = communicationTemplatesResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/communications/templates", cookie),
        )
      ).json(),
    ).templates;
    const ticketTemplate = initialTemplates.find(({ title }) => title === "Ticket Confirmation");
    const otherSystemTemplate = initialTemplates.find(
      ({ title }) => title === "Bundle Ticket Confirmation",
    );
    if (!ticketTemplate || !otherSystemTemplate) {
      throw new Error("The seeded system ticket templates are unavailable.");
    }
    const canonical = ticketMessageTemplates.find(({ kind }) => kind === "confirmation");
    if (!canonical) throw new Error("The canonical ticket confirmation template is unavailable.");
    const ticketConfirmationSettingsBefore = await runInDurableObject<OrganizationStore, string>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly settings: string }>(
            "SELECT ticket_confirmation_settings_json AS settings FROM organization_metadata LIMIT 1",
          )
          .one().settings,
    );

    const updated = communicationTemplateResponseSchema.parse(
      await (
        await exports.default.fetch(
          api(
            "alpha.localhost",
            `/api/organization/communications/templates/${ticketTemplate.id}`,
            cookie,
            {
              body: JSON.stringify({
                channel: "Both",
                contentMarkdown: "Older ticket wording without venue details.",
                subject: "Older ticket subject",
                title: "Older ticket title",
              }),
              headers: { "content-type": "application/json" },
              method: "PUT",
            },
          ),
        )
      ).json(),
    );
    expect(updated).toMatchObject({ channel: "Both", isSystem: true, title: "Older ticket title" });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const reset = await write(
      "alpha.localhost",
      `/api/organization/communications/templates/${ticketTemplate.id}/reset-system-default`,
      cookie,
      {},
    );
    expect(reset.status).toBe(200);
    const restored = communicationTemplateResponseSchema.parse(await reset.json());
    expect(restored).toMatchObject({
      channel: canonical.channel,
      contentMarkdown: canonical.contentMarkdown,
      id: ticketTemplate.id,
      isSystem: true,
      subject: canonical.subject,
      title: canonical.title,
    });
    expect(restored.contentMarkdown).toContain("- **Venue:** {venueName}");
    expect(restored.contentMarkdown).toContain("- **Address:** {venueAddress}");
    expect(Date.parse(restored.updatedAt)).toBeGreaterThan(Date.parse(updated.updatedAt));

    const secondReset = communicationTemplateResponseSchema.parse(
      await (
        await write(
          "alpha.localhost",
          `/api/organization/communications/templates/${ticketTemplate.id}/reset-system-default`,
          cookie,
          {},
        )
      ).json(),
    );
    expect(secondReset).toMatchObject({
      channel: canonical.channel,
      contentMarkdown: canonical.contentMarkdown,
      subject: canonical.subject,
      title: canonical.title,
    });

    const customTemplate = communicationTemplateResponseSchema.parse(
      await (
        await write("alpha.localhost", "/api/organization/communications/templates", cookie, {
          channel: "Email",
          contentMarkdown: "Organization-owned custom wording.",
          subject: "Custom subject",
          title: "Custom template",
        })
      ).json(),
    );
    expect(customTemplate.isSystem).toBe(false);
    const customReset = await write(
      "alpha.localhost",
      `/api/organization/communications/templates/${customTemplate.id}/reset-system-default`,
      cookie,
      {},
    );
    expect(customReset.status).toBe(409);
    expect(await customReset.json()).toMatchObject({ code: "communication_template_not_system" });

    const missingReset = await write(
      "alpha.localhost",
      `/api/organization/communications/templates/${crypto.randomUUID()}/reset-system-default`,
      cookie,
      {},
    );
    expect(missingReset.status).toBe(404);

    const reloadedTemplates = communicationTemplatesResponseSchema.parse(
      await (
        await exports.default.fetch(
          api("alpha.localhost", "/api/organization/communications/templates", cookie),
        )
      ).json(),
    ).templates;
    expect(reloadedTemplates.find(({ id }) => id === ticketTemplate.id)).toMatchObject({
      channel: canonical.channel,
      contentMarkdown: canonical.contentMarkdown,
      id: ticketTemplate.id,
      isSystem: true,
      subject: canonical.subject,
      title: canonical.title,
      updatedAt: secondReset.updatedAt,
    });
    expect(reloadedTemplates.find(({ id }) => id === otherSystemTemplate.id)).toEqual(
      otherSystemTemplate,
    );

    const deliveredTicketTemplate = await runInDurableObject<
      OrganizationStore,
      ReturnType<typeof readTicketMessageTemplate>
    >(stores.get(stores.idFromName("organization-alpha")), (_instance, state) =>
      readTicketMessageTemplate(state.storage, "confirmation"),
    );
    expect(deliveredTicketTemplate).toMatchObject({
      contentMarkdown: canonical.contentMarkdown,
      subject: canonical.subject,
      title: canonical.title,
    });
    const ticketConfirmationSettingsAfter = await runInDurableObject<OrganizationStore, string>(
      stores.get(stores.idFromName("organization-alpha")),
      (_instance, state) =>
        state.storage.sql
          .exec<{ readonly settings: string }>(
            "SELECT ticket_confirmation_settings_json AS settings FROM organization_metadata LIMIT 1",
          )
          .one().settings,
    );
    expect(ticketConfirmationSettingsAfter).toBe(ticketConfirmationSettingsBefore);
  });
});
