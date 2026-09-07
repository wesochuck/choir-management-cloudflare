import {
  CONTACT_EXPORT_SELECTION_MAX,
  contactExportResponseSchema,
  contactSchema,
  type Contact,
} from "@choir/contracts";
import { describe, expect, it } from "vitest";

import {
  buildContactsExportCsv,
  CONTACT_EXPORT_COLUMNS,
  contactExportRow,
  preferenceStatus,
} from "./contactsCsv";

const CONTACT_ID = "11111111-1111-4111-8111-111111111111";

function contactFixture(overrides: Partial<Contact> = {}): Contact {
  return contactSchema.parse({
    createdAt: "2026-08-01T00:00:00.000Z",
    displayName: "Jane Smith",
    email: "jane@example.com",
    firstName: "Jane",
    id: CONTACT_ID,
    lastName: "Smith",
    normalizedEmail: "jane@example.com",
    normalizedPhone: null,
    phone: "+15551234567",
    profileId: null,
    source: "Website signup",
    updatedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  });
}

describe("contacts CSV export (flow: export to CSV)", () => {
  it("emits the documented header row", () => {
    const exported = buildContactsExportCsv([], () => ({
      emailStatus: "unknown",
      listNames: [],
      smsStatus: "unknown",
    }));
    const [header] = exported.csv.split("\n");
    expect(header).toBe(CONTACT_EXPORT_COLUMNS.map((column) => `"${column}"`).join(","));
    expect(exported.downloadName).toBe("contacts.csv");
    expect(exported.rowCount).toBe(0);
    expect(exported.truncated).toBe(false);
    expect(contactExportResponseSchema.safeParse(exported).success).toBe(true);
  });

  it("exports contact fields with statuses and list names", () => {
    const contact = contactFixture();
    const exported = buildContactsExportCsv([contact], () => ({
      emailStatus: "subscribed",
      listNames: ["Concert Audience", "Newsletter"],
      smsStatus: "unsubscribed",
    }));
    expect(exported.rowCount).toBe(1);
    expect(exported.csv).toContain('"Jane Smith"');
    expect(exported.csv).toContain('"jane@example.com"');
    expect(exported.csv).toContain('"\'+15551234567"');
    expect(exported.csv).toContain('"Website signup"');
    expect(exported.csv).toContain('"subscribed"');
    expect(exported.csv).toContain('"unsubscribed"');
    expect(exported.csv).toContain('"Concert Audience; Newsletter"');
  });

  it("neutralizes spreadsheet formula prefixes in exported fields", () => {
    const malicious = contactFixture({
      displayName: "=cmd|' /C calc'!A0",
      email: "valid@example.com",
      firstName: "@Admin",
      phone: "+15551234567",
      source: "+affiliate",
    });
    const row = contactExportRow({
      contact: malicious,
      emailStatus: "unknown",
      listNames: ["=AdminList"],
      smsStatus: "unknown",
    });
    expect(row).toContain("\"'=cmd|' /C calc'!A0\"");
    expect(row).toContain('"\'@Admin"');
    expect(row).toContain('"\'+15551234567"');
    expect(row).toContain('"\'+affiliate"');
    expect(row).toContain('"\'=AdminList"');
  });

  it("escapes quotes and commas, and falls back to email for the display name", () => {
    const quoted = contactFixture({
      displayName: 'Nick "The, Voice" O’Connor',
      email: "nick@example.com",
      firstName: null,
      lastName: null,
      normalizedEmail: "nick@example.com",
    });
    const row = contactExportRow({
      contact: quoted,
      emailStatus: "unknown",
      listNames: [],
      smsStatus: "unknown",
    });
    expect(row).toContain('"Nick ""The, Voice"" O’Connor"');
    const fallback = contactFixture({
      displayName: null,
      email: "solo@example.com",
      firstName: null,
      lastName: null,
      normalizedEmail: "solo@example.com",
    });
    expect(
      contactExportRow({
        contact: fallback,
        emailStatus: "unknown",
        listNames: [],
        smsStatus: "unknown",
      }),
    ).toContain('"solo@example.com"');
  });

  it("caps the selection at the export maximum and reports truncation", () => {
    const contacts = Array.from({ length: CONTACT_EXPORT_SELECTION_MAX + 5 }, (_, index) =>
      contactFixture({
        email: `person${String(index)}@example.com`,
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        normalizedEmail: `person${String(index)}@example.com`,
      }),
    );
    const exported = buildContactsExportCsv(contacts, () => ({
      emailStatus: "unknown",
      listNames: [],
      smsStatus: "unknown",
    }));
    expect(exported.rowCount).toBe(CONTACT_EXPORT_SELECTION_MAX);
    expect(exported.truncated).toBe(true);
    expect(contactExportResponseSchema.safeParse(exported).success).toBe(true);
  });

  it("resolves channel statuses with unknown as the default", () => {
    expect(preferenceStatus([], CONTACT_ID, "email")).toBe("unknown");
    expect(
      preferenceStatus(
        [
          {
            channel: "email",
            contactId: CONTACT_ID,
            observedAt: "2026-08-01T00:00:00.000Z",
            source: null,
            status: "unsubscribed",
          },
        ],
        CONTACT_ID,
        "email",
      ),
    ).toBe("unsubscribed");
  });
});
