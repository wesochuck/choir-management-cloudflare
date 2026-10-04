import { contactSchema, contactListSchema } from "@choir/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import * as api from "../api";
import { ContactsPage } from "./ContactsPage";

const listId = "33333333-3333-4333-8333-333333333333";
const contacts = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
].map((id, index) =>
  contactSchema.parse({
    id,
    displayName: `Contact ${String(index + 1)}`,
    email: `contact${String(index + 1)}@example.test`,
    firstName: null,
    lastName: null,
    normalizedEmail: null,
    phone: null,
    normalizedPhone: null,
    profileId: null,
    source: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  }),
);
const list = contactListSchema.parse({
  id: listId,
  name: "Newsletter",
  description: "",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
});

function setup(hasLists = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const result = { contacts, memberships: [], preferences: [] };
  client.setQueryData(api.queryKeys.organization.contacts({}), result);
  client.setQueryData(api.queryKeys.organization.contactLists, hasLists ? [list] : []);
  vi.spyOn(api, "listAllOrganizationContacts").mockResolvedValue(result);
  vi.spyOn(api, "listOrganizationContactLists").mockResolvedValue(hasLists ? [list] : []);
  render(
    <QueryClientProvider client={client}>
      <ContactsPage enabled />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

afterEach(() => {
  vi.restoreAllMocks();
});

it("requires a destination list before adding or removing selected contacts", async () => {
  const add = vi
    .spyOn(api, "addContactsToContactList")
    .mockResolvedValue({ added: 2, listId, requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  const remove = vi
    .spyOn(api, "removeContactsFromContactList")
    .mockResolvedValue({ removed: 2, listId, requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  const user = setup();
  await user.click(screen.getByRole("checkbox", { name: "Select all matching contacts" }));
  const bulk = within(screen.getByRole("region", { name: "Bulk contact actions" }));
  expect(bulk.getByRole("button", { name: "Add to list" })).toBeDisabled();
  expect(bulk.getByRole("button", { name: "Remove from list" })).toBeDisabled();
  await user.selectOptions(bulk.getByRole("combobox"), listId);
  await user.click(bulk.getByRole("button", { name: "Add to list" }));
  expect(add).toHaveBeenCalledWith(
    listId,
    contacts.map(({ id }) => id),
  );
  expect(await screen.findByText("Added 2 contact(s) to “Newsletter”.")).toBeVisible();
  await user.click(bulk.getByRole("button", { name: "Remove from list" }));
  expect(remove).toHaveBeenCalledWith(
    listId,
    contacts.map(({ id }) => id),
  );
  await user.selectOptions(bulk.getByRole("combobox"), "");
  expect(bulk.getByRole("button", { name: "Add to list" })).toBeDisabled();
  expect(bulk.getByRole("button", { name: "Remove from list" })).toBeDisabled();
});

it("explains where to create a list when no contact lists exist", async () => {
  const user = setup(false);
  await user.click(screen.getByRole("checkbox", { name: "Select all matching contacts" }));
  const bulk = within(screen.getByRole("region", { name: "Bulk contact actions" }));
  expect(bulk.getByText("Create a new list below to add these contacts.")).toBeVisible();
  expect(bulk.getByRole("combobox")).toBeDisabled();
  expect(bulk.getByRole("button", { name: "Add to list" })).toBeDisabled();
});

it("creates a list inline and automatically adds all selected contacts", async () => {
  const create = vi.spyOn(api, "createOrganizationContactList").mockResolvedValue(list);
  const add = vi
    .spyOn(api, "addContactsToContactList")
    .mockResolvedValue({ added: 2, listId, requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  const user = setup(false);
  await user.click(screen.getByRole("checkbox", { name: "Select all matching contacts" }));
  await user.click(screen.getByRole("button", { name: "New list" }));
  expect(screen.getByRole("textbox", { name: "New list name" })).toHaveFocus();
  expect(screen.getByRole("button", { name: "Create list and add contacts" })).toBeDisabled();
  await user.type(screen.getByRole("textbox", { name: "New list name" }), " Newsletter ");
  vi.mocked(api.listOrganizationContactLists).mockResolvedValue([list]);
  await user.keyboard("{Enter}");
  expect(create).toHaveBeenCalledWith({ name: "Newsletter" });
  expect(add).toHaveBeenCalledWith(
    listId,
    contacts.map(({ id }) => id),
  );
  expect(await screen.findByText("Created “Newsletter” and added 2 contact(s).")).toBeVisible();
  expect(
    screen.getByRole("combobox", { name: "Choose a contact list for the bulk action" }),
  ).toHaveValue(listId);
  expect(screen.getByText("2 selected")).toBeVisible();
});

it.each([
  { failure: new Error("Unavailable"), message: "The contact list could not be created." },
  {
    failure: new api.AuthApiError("Forbidden", 403, "forbidden"),
    message: "Only Organization Owners and Administrators can manage contacts.",
  },
])(
  "preserves the inline name and selection when list creation fails: $message",
  async ({ failure, message }) => {
    vi.spyOn(api, "createOrganizationContactList").mockRejectedValue(failure);
    const add = vi.spyOn(api, "addContactsToContactList");
    const user = setup(false);
    await user.click(screen.getByRole("checkbox", { name: "Select all matching contacts" }));
    await user.click(screen.getByRole("button", { name: "New list" }));
    await user.type(screen.getByRole("textbox", { name: "New list name" }), "Newsletter");
    await user.click(screen.getByRole("button", { name: "Create list and add contacts" }));
    expect(await screen.findByText(message)).toBeVisible();
    expect(screen.getByRole("textbox", { name: "New list name" })).toHaveValue("Newsletter");
    expect(screen.getByText("2 selected")).toBeVisible();
    expect(add).not.toHaveBeenCalled();
  },
);

it("keeps the created list selected for retry when adding contacts fails", async () => {
  const create = vi.spyOn(api, "createOrganizationContactList").mockResolvedValue(list);
  const add = vi
    .spyOn(api, "addContactsToContactList")
    .mockRejectedValueOnce(new Error("Unavailable"))
    .mockResolvedValue({ added: 2, listId, requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  const user = setup(false);
  await user.click(screen.getByRole("checkbox", { name: "Select all matching contacts" }));
  await user.click(screen.getByRole("button", { name: "New list" }));
  await user.type(screen.getByRole("textbox", { name: "New list name" }), "Newsletter");
  await user.click(screen.getByRole("button", { name: "Create list and add contacts" }));
  expect(await screen.findByText(/was created, but the contacts could not be added/)).toBeVisible();
  expect(
    screen.getByRole("combobox", { name: "Choose a contact list for the bulk action" }),
  ).toHaveValue(listId);
  vi.mocked(api.listOrganizationContactLists).mockResolvedValue([list]);
  await user.click(screen.getByRole("button", { name: "Add to list" }));
  expect(await screen.findByText("Added 2 contact(s) to “Newsletter”.")).toBeVisible();
  expect(create).toHaveBeenCalledTimes(1);
  expect(add).toHaveBeenCalledTimes(2);
});
