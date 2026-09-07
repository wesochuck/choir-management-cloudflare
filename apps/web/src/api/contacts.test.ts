import {
  contactCommunicationPreferenceSchema,
  contactListSchema,
  contactSchema,
  type Contact,
  type ContactCommunicationPreference,
  type ContactList,
} from "@choir/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addContactsToContactList,
  contactErrorMessage,
  createOrganizationContact,
  createOrganizationContactList,
  deleteOrganizationContact,
  deleteOrganizationContactList,
  getOrganizationContactDetail,
  listAllOrganizationContacts,
  listOrganizationContactLists,
  removeContactsFromContactList,
  updateOrganizationContact,
  updateOrganizationContactList,
} from "./contacts";
import { AuthApiError } from "./client";

const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONTACT_ID = "11111111-1111-4111-8111-111111111111";
const CONTACT_ID_2 = "22222222-2222-4222-8222-222222222222";
const LIST_ID = "33333333-3333-4333-8333-333333333333";
const PROFILE_ID = "44444444-4444-4444-8444-444444444444";

const contactFixture: Contact = contactSchema.parse({
  createdAt: "2026-08-01T00:00:00.000Z",
  displayName: "Jane Smith",
  email: "jane@example.com",
  firstName: "Jane",
  id: CONTACT_ID,
  lastName: "Smith",
  normalizedEmail: "jane@example.com",
  normalizedPhone: null,
  phone: null,
  profileId: null,
  source: "Website signup",
  updatedAt: "2026-08-02T00:00:00.000Z",
});

const emailPreference: ContactCommunicationPreference = contactCommunicationPreferenceSchema.parse({
  channel: "email",
  contactId: CONTACT_ID,
  observedAt: "2026-08-01T00:00:00.000Z",
  source: null,
  status: "subscribed",
});

const smsPreference: ContactCommunicationPreference = contactCommunicationPreferenceSchema.parse({
  channel: "sms",
  contactId: CONTACT_ID,
  observedAt: "2026-08-01T00:00:00.000Z",
  source: null,
  status: "unknown",
});

const listFixture: ContactList = contactListSchema.parse({
  createdAt: "2026-08-01T00:00:00.000Z",
  description: "Monthly updates",
  id: LIST_ID,
  name: "Newsletter",
  updatedAt: "2026-08-01T00:00:00.000Z",
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function problemResponse(code: string, message: string, status: number): Response {
  return jsonResponse({ code, message, requestId: REQUEST_ID }, status);
}

const fetchMock = vi.fn<(url: string | URL | Request, init?: RequestInit) => Promise<Response>>();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  fetchMock.mockReset();
});

function requestBody(init: RequestInit | undefined): unknown {
  const raw: unknown = init?.body;
  if (typeof raw !== "string") return undefined;
  const parsed: unknown = JSON.parse(raw);
  return parsed;
}

function lastCall(): { readonly body: unknown; readonly method: string; readonly url: string } {
  const last = fetchMock.mock.calls.at(-1);
  if (!last) throw new Error("Expected fetch to have been called.");
  const [url, init] = last;
  if (typeof url !== "string") throw new Error("Expected fetch to use a string URL.");
  return {
    body: requestBody(init),
    method: init?.method ?? "GET",
    url,
  };
}

function allUrls(): readonly string[] {
  return fetchMock.mock.calls.map(([url]) => {
    if (typeof url === "string") return url;
    if (url instanceof URL) return url.toString();
    return url.url;
  });
}

describe("organization contacts browser client", () => {
  it("creates a contact through the organization-scoped route (flow: create)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ contact: contactFixture, requestId: REQUEST_ID }, 201),
    );
    const created = await createOrganizationContact({
      email: "jane@example.com",
      emailStatus: "subscribed",
      firstName: "Jane",
      lastName: "Smith",
      source: "Website signup",
    });
    expect(created).toEqual(contactFixture);
    const call = lastCall();
    expect(call.method).toBe("POST");
    expect(call.url).toBe("/api/organization/contacts");
    expect(call.body).toMatchObject({ email: "jane@example.com", firstName: "Jane" });
  });

  it("updates a contact with a partial body (flow: edit)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ contact: contactFixture, requestId: REQUEST_ID }),
    );
    await updateOrganizationContact(CONTACT_ID, { displayName: "Jane S." });
    const call = lastCall();
    expect(call.method).toBe("PATCH");
    expect(call.url).toBe(`/api/organization/contacts/${CONTACT_ID}`);
    expect(call.body).toEqual({ displayName: "Jane S." });
  });

  it("preserves the duplicate-email error code for the editor (flow: duplicate email)", async () => {
    fetchMock.mockResolvedValueOnce(
      problemResponse(
        "contact_duplicate_email",
        "A contact with this email address already exists in this organization.",
        409,
      ),
    );
    const failure: unknown = await createOrganizationContact({ email: "jane@example.com" }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AuthApiError);
    if (!(failure instanceof AuthApiError)) throw new Error("Expected an AuthApiError.");
    expect(failure.code).toBe("contact_duplicate_email");
    expect(failure.status).toBe(409);
    expect(contactErrorMessage(failure, "fallback")).toContain(
      "already exists in this Organization",
    );
  });

  it("lists contacts with search, list, source, and email-status filters (flows: search/filter)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        contacts: [contactFixture],
        hasMore: false,
        memberships: [],
        nextCursor: null,
        preferences: [emailPreference, smsPreference],
        requestId: REQUEST_ID,
      }),
    );
    const result = await listAllOrganizationContacts({
      listId: LIST_ID,
      query: "jane",
      source: "Website signup",
      status: "subscribed",
    });
    expect(result.contacts).toHaveLength(1);
    expect(result.preferences).toHaveLength(2);
    const url = lastCall().url;
    expect(url).toContain("/api/organization/contacts?");
    expect(url).toContain(`listId=${LIST_ID}`);
    expect(url).toContain("query=jane");
    expect(url).toContain("source=Website+signup");
    expect(url).toContain("channel=email");
    expect(url).toContain("status=subscribed");
  });

  it("fetches contact detail with preferences and list membership (flow: edit loads detail)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        activity: { donationCount: 2, ticketPurchaseCount: 4 },
        contact: contactFixture,
        lastEmailAt: "2026-08-12T10:00:00.000Z",
        linkedProfile: { displayName: "Jane Singer", id: PROFILE_ID },
        listIds: [LIST_ID],
        lists: [{ id: LIST_ID, name: "Newsletter" }],
        preferences: [emailPreference, smsPreference],
        requestId: REQUEST_ID,
      }),
    );
    const detail = await getOrganizationContactDetail(CONTACT_ID);
    expect(detail.contact).toEqual(contactFixture);
    expect(detail.listIds).toEqual([LIST_ID]);
    expect(detail.preferences).toHaveLength(2);
    expect(detail.activity).toEqual({ donationCount: 2, ticketPurchaseCount: 4 });
    expect(detail.linkedProfile).toEqual({ displayName: "Jane Singer", id: PROFILE_ID });
    expect(detail.lists).toEqual([{ id: LIST_ID, name: "Newsletter" }]);
    expect(detail.lastEmailAt).toBe("2026-08-12T10:00:00.000Z");
    expect(lastCall().url).toBe(`/api/organization/contacts/${CONTACT_ID}`);
  });

  it("defaults missing detail enrichment for older detail payloads", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        contact: contactFixture,
        listIds: [],
        preferences: [],
        requestId: REQUEST_ID,
      }),
    );
    const detail = await getOrganizationContactDetail(CONTACT_ID);
    expect(detail.activity).toEqual({ donationCount: 0, ticketPurchaseCount: 0 });
    expect(detail.linkedProfile).toBeNull();
    expect(detail.lists).toEqual([]);
    expect(detail.lastEmailAt).toBeNull();
  });

  it("creates a contact list (flow: create list)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ list: listFixture, requestId: REQUEST_ID }, 201),
    );
    const created = await createOrganizationContactList({
      description: "Monthly updates",
      name: "Newsletter",
    });
    expect(created).toEqual(listFixture);
    const call = lastCall();
    expect(call.method).toBe("POST");
    expect(call.url).toBe("/api/organization/contact-lists");
    expect(call.body).toEqual({ description: "Monthly updates", name: "Newsletter" });
  });

  it("renames a contact list and lists all contact lists", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ list: listFixture, requestId: REQUEST_ID }))
      .mockResolvedValueOnce(
        jsonResponse({
          hasMore: false,
          lists: [listFixture],
          nextCursor: null,
          requestId: REQUEST_ID,
        }),
      );
    await updateOrganizationContactList(LIST_ID, { name: "Newsletter" });
    const updateCall = lastCall();
    expect(updateCall.method).toBe("PATCH");
    expect(updateCall.url).toBe(`/api/organization/contact-lists/${LIST_ID}`);
    const lists = await listOrganizationContactLists();
    expect(lists).toEqual([listFixture]);
    expect(lastCall().url).toBe("/api/organization/contact-lists");
  });

  it("adds contacts to a list in bulk (flow: add to list)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ added: 2, listId: LIST_ID, requestId: REQUEST_ID }),
    );
    const result = await addContactsToContactList(LIST_ID, [CONTACT_ID, CONTACT_ID_2]);
    expect(result.added).toBe(2);
    const call = lastCall();
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`/api/organization/contact-lists/${LIST_ID}/members`);
    expect(call.body).toEqual({ contactIds: [CONTACT_ID, CONTACT_ID_2] });
  });

  it("removes contacts from a list in bulk (flow: remove from list)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ listId: LIST_ID, removed: 1, requestId: REQUEST_ID }),
    );
    const result = await removeContactsFromContactList(LIST_ID, [CONTACT_ID]);
    expect(result.removed).toBe(1);
    const call = lastCall();
    expect(call.method).toBe("DELETE");
    expect(call.url).toBe(`/api/organization/contact-lists/${LIST_ID}/members`);
    expect(call.body).toEqual({ contactIds: [CONTACT_ID] });
  });

  it("deletes a contact list through the scoped route (flow: delete list preserves contacts)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ listId: LIST_ID, requestId: REQUEST_ID, status: "deleted" }),
    );
    await deleteOrganizationContactList(LIST_ID);
    const call = lastCall();
    expect(call.method).toBe("DELETE");
    expect(call.url).toBe(`/api/organization/contact-lists/${LIST_ID}`);
  });

  it("deletes a contact through the scoped route (flow: delete contact)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ contactId: CONTACT_ID, requestId: REQUEST_ID, status: "deleted" }),
    );
    await deleteOrganizationContact(CONTACT_ID);
    const call = lastCall();
    expect(call.method).toBe("DELETE");
    expect(call.url).toBe(`/api/organization/contacts/${CONTACT_ID}`);
  });

  it("never addresses another Organization: requests carry no organization identifier (flow: cross-org isolation)", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          contacts: [],
          hasMore: false,
          memberships: [],
          nextCursor: null,
          preferences: [],
          requestId: REQUEST_ID,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ hasMore: false, lists: [], nextCursor: null, requestId: REQUEST_ID }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          contact: contactFixture,
          listIds: [],
          preferences: [],
          requestId: REQUEST_ID,
        }),
      );
    await listAllOrganizationContacts({ listId: LIST_ID, query: "x" });
    await listOrganizationContactLists();
    await getOrganizationContactDetail(CONTACT_ID);
    for (const url of allUrls()) {
      // Tenant resolution is hostname-based on the server; the browser must
      // never select storage with a client-supplied organization value.
      expect(url.startsWith("/api/organization/")).toBe(true);
      expect(url).not.toContain("organizationId");
      expect(url).not.toContain("organization_id");
      expect(url).not.toContain("tenant");
    }
    const bodies: unknown[] = fetchMock.mock.calls.map(([, init]) => requestBody(init));
    for (const body of bodies) {
      expect(JSON.stringify(body ?? null)).not.toContain("organizationId");
    }
  });

  it("maps authorization failures to an actionable message", () => {
    const message = contactErrorMessage(
      new AuthApiError("Forbidden", 403, "forbidden"),
      "fallback",
    );
    expect(message).toContain("Organization Owners and Administrators");
  });
});
