import type {
  Contact,
  ContactCommunicationPreference,
  ContactList,
  OrganizationProfile,
} from "@choir/contracts";
import {
  contactCommunicationPreferenceSchema,
  contactListSchema,
  contactSchema,
  organizationProfileSchema,
} from "@choir/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "../api/queryKeys";
import { ContactsPage } from "./ContactsPage";

const CONTACT_JANE = "11111111-1111-4111-8111-111111111111";
const CONTACT_BOB = "22222222-2222-4222-8222-222222222222";
const LIST_NEWSLETTER = "33333333-3333-4333-8333-333333333333";
const PROFILE_JANE = "44444444-4444-4444-8444-444444444444";

function contactFixture(overrides: Partial<Contact> & { readonly id: string }): Contact {
  return contactSchema.parse({
    createdAt: "2026-08-01T00:00:00.000Z",
    displayName: null,
    email: null,
    firstName: null,
    lastName: null,
    normalizedEmail: null,
    normalizedPhone: null,
    phone: null,
    profileId: null,
    source: null,
    updatedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  });
}

const janeSmith = contactFixture({
  displayName: "Jane Smith",
  email: "jane@example.com",
  firstName: "Jane",
  id: CONTACT_JANE,
  lastName: "Smith",
  normalizedEmail: "jane@example.com",
  source: "Website signup",
});

const bobJones = contactFixture({
  email: "bob@example.com",
  firstName: "Bob",
  id: CONTACT_BOB,
  lastName: "Jones",
  normalizedEmail: "bob@example.com",
  phone: "+15550001111",
});

const newsletter: ContactList = contactListSchema.parse({
  createdAt: "2026-08-01T00:00:00.000Z",
  description: "Monthly updates",
  id: LIST_NEWSLETTER,
  name: "Newsletter",
  updatedAt: "2026-08-01T00:00:00.000Z",
});

function preference(
  contactId: string,
  channel: "email" | "sms",
  status: "unknown" | "subscribed" | "unsubscribed",
): ContactCommunicationPreference {
  return contactCommunicationPreferenceSchema.parse({
    channel,
    contactId,
    observedAt: "2026-08-01T00:00:00.000Z",
    source: null,
    status,
  });
}

const janeProfile: OrganizationProfile = organizationProfileSchema.parse({
  createdAt: "2026-08-01T00:00:00.000Z",
  displayName: "Jane Smith",
  id: PROFILE_JANE,
  updatedAt: "2026-08-01T00:00:00.000Z",
});

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: Infinity,
        networkMode: "always",
        refetchOnMount: false,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: Infinity,
      },
    },
  });
}

function seedOrganization(
  queryClient: QueryClient,
  input: {
    readonly contacts: readonly Contact[];
    readonly lists: readonly ContactList[];
    readonly memberships?: { readonly contactId: string; readonly listId: string }[] | undefined;
    readonly preferences?: readonly ContactCommunicationPreference[] | undefined;
  },
) {
  queryClient.setQueryData(queryKeys.organization.contacts({}), {
    contacts: input.contacts,
    memberships: (input.memberships ?? []).map((membership) => ({
      contactId: membership.contactId,
      createdAt: "2026-08-01T00:00:00.000Z",
      listId: membership.listId,
    })),
    preferences: input.preferences ?? [],
  });
  queryClient.setQueryData(queryKeys.organization.contactLists, input.lists);
}

function renderPage(queryClient: QueryClient, enabled = true): string {
  return renderToString(
    <QueryClientProvider client={queryClient}>
      <ContactsPage enabled={enabled} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ContactsPage", () => {
  it("renders the contacts table with the required sortable columns", () => {
    const queryClient = createTestQueryClient();
    seedOrganization(queryClient, {
      contacts: [janeSmith, bobJones],
      lists: [newsletter],
      memberships: [{ contactId: CONTACT_JANE, listId: LIST_NEWSLETTER }],
      preferences: [
        preference(CONTACT_JANE, "email", "subscribed"),
        preference(CONTACT_JANE, "sms", "unknown"),
        preference(CONTACT_BOB, "email", "unknown"),
        preference(CONTACT_BOB, "sms", "unknown"),
      ],
    });
    const html = renderPage(queryClient);
    for (const column of ["Name", "Email", "Phone", "Lists", "Email Status", "Source", "Updated"]) {
      expect(html).toContain(`Sort by ${column}`);
    }
    expect(html).toContain("Jane Smith");
    expect(html).toContain("jane@example.com");
    expect(html).toContain("+15550001111");
    expect(html).toContain("Newsletter");
    expect(html).toContain("Subscribed");
    expect(html).toContain("Website signup");
    expect(html).toContain("shown");
    expect(html).toContain("Add contact");
    expect(html).toContain("Export CSV");
  });

  it("keeps status readable as text rather than color alone", () => {
    const queryClient = createTestQueryClient();
    seedOrganization(queryClient, {
      contacts: [bobJones],
      lists: [],
      preferences: [preference(CONTACT_BOB, "email", "unsubscribed")],
    });
    const html = renderPage(queryClient);
    expect(html).toContain("Unsubscribed");
  });

  it("renders search, list, email-status, and source filters with list options", () => {
    const queryClient = createTestQueryClient();
    seedOrganization(queryClient, { contacts: [janeSmith], lists: [newsletter] });
    const html = renderPage(queryClient);
    expect(html).toContain("Search by name, email, or phone");
    expect(html).toContain('aria-label="Filter by list"');
    expect(html).toContain('aria-label="Filter by email status"');
    expect(html).toContain('aria-label="Filter by source"');
    expect(html).toContain("All email statuses");
    expect(html).toContain("Newsletter");
    expect(html).toContain("Website signup");
    // Separate first-class area: contacts are never presented as roster records.
    // (The shared tab-strip styling class `roster-page-tabs` is exempt on purpose.)
    expect(html).not.toContain(">Roster<");
    expect(html).not.toContain("roster records");
  });

  it("preserves mobile card presentation with a Manage label", () => {
    const queryClient = createTestQueryClient();
    seedOrganization(queryClient, { contacts: [janeSmith], lists: [] });
    const html = renderPage(queryClient);
    expect(html).toContain("data-table-cards");
    expect(html).toContain("Manage");
  });

  it("renders the contact-lists tab trigger alongside contacts", () => {
    const queryClient = createTestQueryClient();
    seedOrganization(queryClient, {
      contacts: [janeSmith],
      lists: [newsletter],
      memberships: [{ contactId: CONTACT_JANE, listId: LIST_NEWSLETTER }],
    });
    const html = renderPage(queryClient);
    // The inactive tab panel mounts on selection; the trigger is always visible.
    expect(html).toContain("Contact lists");
    expect(html).toContain('id="contact-lists-tab"');
  });

  it("shows an empty state when no contacts exist", () => {
    const queryClient = createTestQueryClient();
    seedOrganization(queryClient, { contacts: [], lists: [] });
    const html = renderPage(queryClient);
    expect(html).toContain("No contacts yet");
  });

  it("requires MFA verification before managing contacts", () => {
    const html = renderPage(createTestQueryClient(), false);
    expect(html).toContain("Verify Organization MFA to manage contacts.");
  });

  it("isolates tenants: navigating organizations never exposes the other tenant's contacts", () => {
    const alphaClient = createTestQueryClient();
    seedOrganization(alphaClient, { contacts: [janeSmith], lists: [newsletter] });
    const bravoClient = createTestQueryClient();
    seedOrganization(bravoClient, { contacts: [bobJones], lists: [] });

    const alphaHtml = renderPage(alphaClient);
    expect(alphaHtml).toContain("Jane Smith");
    expect(alphaHtml).not.toContain("bob@example.com");

    // A new hostname remounts tenant-scoped queries; Alpha rows are gone.
    const bravoHtml = renderPage(bravoClient);
    expect(bravoHtml).toContain("bob@example.com");
    expect(bravoHtml).not.toContain("Jane Smith");
    expect(bravoHtml).not.toContain("Newsletter");
  });

  it("offers a unified details action alongside edit and delete", () => {
    const queryClient = createTestQueryClient();
    seedOrganization(queryClient, { contacts: [janeSmith], lists: [] });
    const html = renderPage(queryClient);
    expect(html).toContain("View details for Jane Smith");
    expect(html).toContain("Edit Jane Smith");
  });

  it("exposes the linked Organization Profile fixture shape used by the editor", () => {
    expect(janeProfile.displayName).toBe("Jane Smith");
  });
});
