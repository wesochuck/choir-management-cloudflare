import { describe, expect, it } from "vitest";

import {
  dedupeCommunicationCandidates,
  type CommunicationRecipientCandidate,
} from "./communicationRecipients";

function candidate(
  overrides: Partial<CommunicationRecipientCandidate> & {
    readonly email?: string | null;
    readonly subjectId: string;
  },
): CommunicationRecipientCandidate {
  return {
    displayName: "Recipient",
    doNotEmail: false,
    email: null,
    emailSuppressed: false,
    emailUnsubscribed: false,
    phone: null,
    providerBounced: false,
    smsSuppressed: false,
    smsUnsubscribed: false,
    subjectKind: "profile",
    ...overrides,
  };
}

const member = (email: string, subjectId = "member-1") =>
  candidate({ displayName: "Jane Member", email, subjectId, subjectKind: "profile" });
const contact = (email: string, subjectId = "contact-1") =>
  candidate({ displayName: "Jane Contact", email, subjectId, subjectKind: "contact" });
const buyer = (email: string, subjectId = "purchase-1") =>
  candidate({ displayName: "Jane Buyer", email, subjectId, subjectKind: "ticket_purchase" });
const donor = (email: string, subjectId = "donation-1") =>
  candidate({ displayName: "Jane Donor", email, subjectId, subjectKind: "donation" });

function deliveredEmails(resolved: ReturnType<typeof dedupeCommunicationCandidates>): string[] {
  return resolved.map((recipient) => recipient.email).filter((email) => email !== "");
}

describe("dedupeCommunicationCandidates", () => {
  it("resolves member-only and contact-only audiences", () => {
    expect(deliveredEmails(dedupeCommunicationCandidates([member("jane@example.com")]))).toEqual([
      "jane@example.com",
    ]);
    expect(deliveredEmails(dedupeCommunicationCandidates([contact("bob@example.com")]))).toEqual([
      "bob@example.com",
    ]);
  });

  it("merges a member and contact sharing one email into a single delivery", () => {
    const resolved = dedupeCommunicationCandidates([
      member("Jane@Example.com"),
      contact("jane@example.com"),
    ]);
    expect(deliveredEmails(resolved)).toEqual(["jane@example.com"]);
  });

  it("merges a contact selected through two lists into a single delivery", () => {
    const resolved = dedupeCommunicationCandidates([
      contact("jane@example.com", "contact-1"),
      contact("JANE@example.com ", "contact-1"),
    ]);
    expect(deliveredEmails(resolved)).toEqual(["jane@example.com"]);
  });

  it("merges contact, ticket buyer, and donor identities sharing one email", () => {
    expect(
      deliveredEmails(
        dedupeCommunicationCandidates([contact("jane@example.com"), buyer("jane@example.com")]),
      ),
    ).toEqual(["jane@example.com"]);
    expect(
      deliveredEmails(
        dedupeCommunicationCandidates([contact("jane@example.com"), donor("jane@example.com")]),
      ),
    ).toEqual(["jane@example.com"]);
    expect(
      deliveredEmails(
        dedupeCommunicationCandidates([
          member("jane@example.com"),
          contact("jane@example.com"),
          buyer("jane@example.com"),
          donor("jane@example.com"),
        ]),
      ),
    ).toEqual(["jane@example.com"]);
  });

  it("keeps the same display name with different emails as separate recipients", () => {
    const resolved = dedupeCommunicationCandidates([
      contact("jane@example.com", "contact-1"),
      contact("jane.smith@example.com", "contact-2"),
    ]);
    expect(deliveredEmails(resolved).sort()).toEqual(
      ["jane@example.com", "jane.smith@example.com"].sort(),
    );
  });

  it("lets suppression from either identity block the shared destination", () => {
    expect(
      deliveredEmails(
        dedupeCommunicationCandidates([
          member("jane@example.com"),
          { ...contact("jane@example.com"), emailUnsubscribed: true },
        ]),
      ),
    ).toEqual([]);
    expect(
      deliveredEmails(
        dedupeCommunicationCandidates([
          { ...member("jane@example.com"), doNotEmail: true },
          contact("jane@example.com"),
        ]),
      ),
    ).toEqual([]);
    expect(
      deliveredEmails(
        dedupeCommunicationCandidates([
          member("jane@example.com"),
          { ...contact("jane@example.com"), emailSuppressed: true },
        ]),
      ),
    ).toEqual([]);
    expect(
      deliveredEmails(
        dedupeCommunicationCandidates([
          member("jane@example.com"),
          { ...buyer("jane@example.com"), providerBounced: true },
        ]),
      ),
    ).toEqual([]);
  });

  it("dedupes SMS by normalized phone with unsubscribe precedence", () => {
    const resolved = dedupeCommunicationCandidates([
      candidate({
        displayName: "Jane",
        phone: "(555) 123-4567",
        subjectId: "member-1",
        subjectKind: "profile",
      }),
      candidate({
        displayName: "Jane Contact",
        phone: "+15551234567",
        subjectId: "contact-1",
        subjectKind: "contact",
      }),
    ]);
    const delivered = resolved.map((recipient) => recipient.phone).filter(Boolean);
    expect(delivered).toEqual(["+15551234567"]);

    const blocked = dedupeCommunicationCandidates([
      candidate({
        displayName: "Jane",
        phone: "+15551234567",
        subjectId: "member-1",
        subjectKind: "profile",
      }),
      candidate({
        displayName: "Jane Contact",
        phone: "+15551234567",
        smsUnsubscribed: true,
        subjectId: "contact-1",
        subjectKind: "contact",
      }),
    ]);
    expect(blocked.map((recipient) => recipient.phone).filter(Boolean)).toEqual([]);
  });

  it("drops missing and invalid destinations without delivering", () => {
    const resolved = dedupeCommunicationCandidates([
      candidate({ displayName: "No Contact", subjectId: "contact-1", subjectKind: "contact" }),
      candidate({
        displayName: "Bad Email",
        email: "not-an-email",
        subjectId: "contact-2",
        subjectKind: "contact",
      }),
      candidate({
        displayName: "Bad Phone",
        phone: "not-a-phone",
        subjectId: "contact-3",
        subjectKind: "contact",
      }),
      member("ok@example.com"),
    ]);
    expect(deliveredEmails(resolved)).toEqual(["ok@example.com"]);
    expect(resolved.map((recipient) => recipient.phone).filter(Boolean)).toEqual([]);
  });

  it("returns an empty audience for empty input", () => {
    expect(dedupeCommunicationCandidates([])).toEqual([]);
  });

  it("preserves per-channel eligibility for mixed blocking", () => {
    const resolved = dedupeCommunicationCandidates([
      { ...member("jane@example.com"), doNotEmail: true, phone: "+15551234567" },
    ]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.email).toBe("");
    expect(resolved[0]?.phone).toBe("+15551234567");
  });
});
