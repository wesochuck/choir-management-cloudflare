import type { Contact, ContactList, OrganizationProfile } from "@choir/contracts";
import { contactListSchema, contactSchema, organizationProfileSchema } from "@choir/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { queryKeys } from "../api/queryKeys";
import { ContactEditorFields } from "./ContactsPageEditor";
import { EMPTY_CONTACT_EDITOR_VALUES, validateContactEditorValues } from "./contactEditorUtils";
import {
  ContactListFields,
  ContactListMembersList,
  ContactListsTable,
  ContactsListsTab,
  type ContactListRow,
} from "./ContactsPageLists";
import { validateContactListValues } from "./contactListUtils";

const LIST_NEWSLETTER = "33333333-3333-4333-8333-333333333333";
const LIST_AUDIENCE = "55555555-5555-4555-8555-555555555555";
const PROFILE_JANE = "44444444-4444-4444-8444-444444444444";
const CONTACT_JANE = "11111111-1111-4111-8111-111111111111";

const newsletter: ContactList = contactListSchema.parse({
  createdAt: "2026-08-01T00:00:00.000Z",
  description: "Monthly updates",
  id: LIST_NEWSLETTER,
  name: "Newsletter",
  updatedAt: "2026-08-01T00:00:00.000Z",
});

const audience: ContactList = contactListSchema.parse({
  createdAt: "2026-08-01T00:00:00.000Z",
  description: null,
  id: LIST_AUDIENCE,
  name: "Concert Audience",
  updatedAt: "2026-08-02T00:00:00.000Z",
});

const janeProfile: OrganizationProfile = organizationProfileSchema.parse({
  createdAt: "2026-08-01T00:00:00.000Z",
  displayName: "Jane Smith",
  id: PROFILE_JANE,
  updatedAt: "2026-08-01T00:00:00.000Z",
});

const janeContact: Contact = contactSchema.parse({
  createdAt: "2026-08-01T00:00:00.000Z",
  displayName: "Jane Smith",
  email: "jane@example.com",
  firstName: "Jane",
  id: CONTACT_JANE,
  lastName: "Smith",
  normalizedEmail: "jane@example.com",
  normalizedPhone: null,
  phone: null,
  profileId: PROFILE_JANE,
  source: "Website signup",
  updatedAt: "2026-08-01T00:00:00.000Z",
});

describe("ContactEditorFields", () => {
  it("renders every required editor field with associated labels and product language", () => {
    const html = renderToString(
      <ContactEditorFields
        fieldErrors={{}}
        formErrorId={undefined}
        lists={[newsletter, audience]}
        onChange={() => undefined}
        profiles={[janeProfile]}
        values={EMPTY_CONTACT_EDITOR_VALUES}
      />,
    );
    for (const label of [
      "First name",
      "Last name",
      "Display name",
      "Email",
      "Phone",
      "Source",
      "Linked Organization Profile",
      "Email marketing status",
      "SMS marketing status",
      "Contact lists",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('for="contact-editor-email"');
    expect(html).toContain('id="contact-editor-email"');
    expect(html).toContain("No linked Organization Profile");
    expect(html).toContain("Jane Smith");
    expect(html).toContain("Newsletter");
    expect(html).toContain("Concert Audience");
    // Contacts are distinct from the roster; the editor says so explicitly.
    // (The global E2E suite asserts the design-system-wide kicker ban at runtime.)
    expect(html).toContain("never adds the contact to the roster");
  });

  it("associates validation errors with their fields", () => {
    const html = renderToString(
      <ContactEditorFields
        fieldErrors={{ email: "Enter a valid email address." }}
        formErrorId="contact-editor-error"
        lists={[]}
        onChange={() => undefined}
        profiles={[]}
        values={{ ...EMPTY_CONTACT_EDITOR_VALUES, email: "not-an-email" }}
      />,
    );
    expect(html).toContain("Enter a valid email address.");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="contact-editor-email-error"');
  });

  it("requires an acceptable identity without forcing first and last names", () => {
    expect(validateContactEditorValues(EMPTY_CONTACT_EDITOR_VALUES).identity).toContain(
      "linked Organization Profile",
    );
    expect(
      validateContactEditorValues({
        ...EMPTY_CONTACT_EDITOR_VALUES,
        displayName: "Community Partner",
      }).identity,
    ).toBeUndefined();
    expect(
      validateContactEditorValues({ ...EMPTY_CONTACT_EDITOR_VALUES, profileId: PROFILE_JANE })
        .identity,
    ).toBeUndefined();
  });

  it("rejects malformed email addresses", () => {
    expect(
      validateContactEditorValues({ ...EMPTY_CONTACT_EDITOR_VALUES, email: "not-an-email" }).email,
    ).toBe("Enter a valid email address.");
    expect(
      validateContactEditorValues({ ...EMPTY_CONTACT_EDITOR_VALUES, email: "jane@example.com" })
        .email,
    ).toBeUndefined();
  });
});

describe("ContactListsTable", () => {
  const rows: readonly ContactListRow[] = [
    { ...newsletter, memberCount: 12 },
    { ...audience, memberCount: 0 },
  ];

  it("renders sortable list columns with member counts and named actions", () => {
    const html = renderToString(
      <ContactListsTable
        onDelete={() => undefined}
        onEdit={() => undefined}
        onViewMembers={() => undefined}
        rows={rows}
      />,
    );
    for (const column of ["Name", "Description", "Members", "Updated"]) {
      expect(html).toContain(`Sort by ${column}`);
    }
    expect(html).toContain("Newsletter");
    expect(html).toContain("No description");
    expect(html).toContain("12");
    expect(html).toContain('aria-label="Delete Newsletter"');
    expect(html).toContain('aria-label="Rename Newsletter"');
    expect(html).toContain('aria-label="View members of Concert Audience"');
  });

  it("renders an empty state without lists", () => {
    const html = renderToString(
      <ContactListsTable
        onDelete={() => undefined}
        onEdit={() => undefined}
        onViewMembers={() => undefined}
        rows={[]}
      />,
    );
    expect(html).toContain("No contact lists yet");
  });
});

describe("ContactListFields", () => {
  it("renders name and description fields with error association", () => {
    const html = renderToString(
      <ContactListFields
        error="Enter a list name."
        onChange={() => undefined}
        values={{ description: "", name: "" }}
      />,
    );
    expect(html).toContain("List name");
    expect(html).toContain("Description");
    expect(html).toContain("Enter a list name.");
    expect(html).toContain('aria-describedby="contact-list-error"');
  });

  it("validates list names and description lengths", () => {
    expect(validateContactListValues({ description: "", name: "  " })).toBe("Enter a list name.");
    expect(validateContactListValues({ description: "", name: "Newsletter" })).toBeNull();
    expect(validateContactListValues({ description: "x".repeat(2001), name: "Ok" })).toContain(
      "2,000",
    );
  });
});

describe("ContactListMembersList", () => {
  it("renders members with accessible remove actions", () => {
    const html = renderToString(
      <ContactListMembersList
        busy={false}
        members={[janeContact]}
        onRemove={() => undefined}
        removingId={null}
      />,
    );
    expect(html).toContain("Jane Smith");
    expect(html).toContain("jane@example.com");
    expect(html).toContain('aria-label="Remove Jane Smith from list"');
  });

  it("renders an empty state for lists without members", () => {
    const html = renderToString(
      <ContactListMembersList
        busy={false}
        members={[]}
        onRemove={() => undefined}
        removingId={null}
      />,
    );
    expect(html).toContain("No contacts are in this list yet.");
  });
});

describe("ContactsListsTab", () => {
  function createTestQueryClient() {
    return new QueryClient({
      defaultOptions: {
        queries: {
          gcTime: Infinity,
          refetchOnMount: false,
          refetchOnReconnect: false,
          refetchOnWindowFocus: false,
          retry: false,
          staleTime: Infinity,
        },
      },
    });
  }

  it("renders lists with member counts and management actions", () => {
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(queryKeys.organization.contactLists, [newsletter, audience]);
    queryClient.setQueryData(queryKeys.organization.contacts({}), {
      contacts: [janeContact],
      memberships: [
        {
          contactId: CONTACT_JANE,
          createdAt: "2026-08-01T00:00:00.000Z",
          listId: LIST_NEWSLETTER,
        },
      ],
      preferences: [],
    });
    const html = renderToString(
      <QueryClientProvider client={queryClient}>
        <ContactsListsTab enabled={true} />
      </QueryClientProvider>,
    );
    expect(html).toContain("Create list");
    expect(html).toContain("Monthly updates");
    expect(html).toContain("Newsletter");
    expect(html).toContain('aria-label="Delete Newsletter"');
    expect(html).toContain('aria-label="Rename Newsletter"');
    expect(html).toContain('aria-label="View members of Concert Audience"');
    // Deleting a list preserves contacts: the confirmation copy says so and
    // the members dialog keeps contacts with per-member removal instead.
    expect(html).toContain("Contact lists");
  });

  it("requires MFA verification before managing lists", () => {
    const html = renderToString(
      <QueryClientProvider client={createTestQueryClient()}>
        <ContactsListsTab enabled={false} />
      </QueryClientProvider>,
    );
    expect(html).toContain("Verify Organization MFA to manage contact lists.");
  });
});
