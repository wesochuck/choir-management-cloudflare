import { contactCreateRequestSchema, contactSchema, type ContactList } from "@choir/contracts";
import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";

const requestId = "99999999-9999-4999-8999-999999999999";
const listId = "33333333-3333-4333-8333-333333333333";
const timestamp = "2026-08-01T00:00:00.000Z";

test("creates an inline list with selected contacts in both themes", async ({ page }) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  const contact = contactSchema.parse({
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "Browser Contact",
    email: "contact@example.test",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  const lists: ContactList[] = [];
  let added = false;
  await page.route("**/api/organization/contacts?*", async (route) => {
    await route.fulfill({
      json: {
        contacts: [contact],
        preferences: [],
        memberships: added ? [{ contactId: contact.id, listId, createdAt: timestamp }] : [],
        hasMore: false,
        nextCursor: null,
        requestId,
      },
    });
  });
  await page.route("**/api/organization/contact-lists", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({ name: "Concert friends" });
      const list = {
        id: listId,
        name: "Concert friends",
        description: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      lists.push(list);
      await route.fulfill({ json: { list, requestId } });
    } else {
      await route.fulfill({ json: { lists, requestId } });
    }
  });
  await page.route(`**/api/organization/contact-lists/${listId}/members`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({ contactIds: [contact.id] });
    added = true;
    await route.fulfill({ json: { added: 1, listId, requestId } });
  });
  await page.goto("/admin/contacts");
  await page.getByRole("checkbox", { name: "Select Browser Contact" }).check();
  await page.getByRole("button", { name: "New list", exact: true }).click();
  const name = page.getByRole("textbox", { name: "New list name" });
  await expect(name).toBeFocused();
  await name.fill("Concert friends");
  for (const theme of ["light", "dark"] as const) {
    const toggle = page.getByRole("button", { name: `Switch to ${theme} theme` });
    if (await toggle.isVisible()) await toggle.click();
    await expect(name).toBeVisible();
    await expect(page.getByRole("button", { name: "Create list and add contacts" })).toBeEnabled();
    const fits = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    );
    expect(fits).toBe(true);
  }
  await name.press("Enter");
  await expect(page.getByText("Created “Concert friends” and added 1 contact(s).")).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Choose a contact list for the bulk action" }),
  ).toHaveValue(listId);
  expect(added).toBe(true);
  expect(lists).toHaveLength(1);
  api.assertNoUnexpectedRequests();
});

test("creates and deletes contact with immediate table and count synchronization (#168)", async ({
  page,
}) => {
  const api = await installOrganizationApi(page, { role: "administrator", strict: true });
  interface MockContact {
    readonly id: string;
    readonly displayName: string | null;
    readonly firstName: string | null;
    readonly lastName: string | null;
    readonly email: string | null;
    readonly phone: string | null;
    readonly source: string | null;
    readonly normalizedEmail: string | null;
    readonly normalizedPhone: string | null;
    readonly profileId: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
  }
  const contacts: MockContact[] = [];
  let nextId = 1;

  await page.route("**/api/organization/contacts?*", async (route) => {
    await route.fulfill({
      json: {
        contacts,
        hasMore: false,
        memberships: [],
        nextCursor: null,
        preferences: [],
        requestId,
      },
    });
  });

  await page.route("**/api/organization/contact-lists", async (route) => {
    await route.fulfill({ json: { lists: [], requestId } });
  });

  await page.route("**/api/organization/profiles", async (route) => {
    await route.fulfill({ json: { profiles: [], requestId } });
  });

  await page.route("**/api/organization/contacts", async (route) => {
    if (route.request().method() === "POST") {
      const parsed = contactCreateRequestSchema.safeParse(route.request().postDataJSON());
      const data = parsed.success ? parsed.data : {};
      const id = `11111111-1111-4111-8111-${String(nextId++).padStart(12, "0")}`;
      const newContact: MockContact = {
        createdAt: timestamp,
        displayName: data.displayName ?? null,
        email: data.email ?? null,
        firstName: data.firstName ?? null,
        id,
        lastName: data.lastName ?? null,
        normalizedEmail: data.email?.toLowerCase() ?? null,
        normalizedPhone: null,
        phone: data.phone ?? null,
        profileId: null,
        source: data.source ?? null,
        updatedAt: timestamp,
      };
      contacts.push(newContact);
      await route.fulfill({ json: { contact: newContact, requestId } });
    } else {
      await route.fallback();
    }
  });

  await page.route("**/api/organization/contacts/*", async (route) => {
    if (route.request().method() === "DELETE") {
      const url = route.request().url();
      const contactId = url.split("/").pop();
      const index = contacts.findIndex((candidate) => candidate.id === contactId);
      if (index !== -1) {
        contacts.splice(index, 1);
      }
      await route.fulfill({ json: { contactId, requestId, status: "deleted" } });
    } else {
      await route.fallback();
    }
  });

  await page.goto("/admin/contacts");
  await expect(page.getByText("0 shown")).toBeVisible();
  await expect(page.getByText("No contacts yet")).toBeVisible();

  // Create contact
  await page.getByRole("button", { name: "Add contact" }).click();
  const dialog = page.getByRole("dialog", { name: "Add contact" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("First name").fill("Sarah");
  await dialog.getByLabel("Last name").fill("Connor");
  await dialog.getByLabel("Email", { exact: true }).fill("sarah@example.test");
  await dialog.getByRole("button", { name: "Create contact" }).click();

  // Verify dialog closed and table updated immediately without page reload
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("Contact created.")).toBeVisible();
  await expect(page.getByText("1 shown")).toBeVisible();
  const visibleContacts = page.locator(".data-table:visible, .data-table-cards:visible");
  await expect(visibleContacts.getByText("Sarah Connor")).toBeVisible();
  await expect(page.getByText("No contacts yet")).not.toBeVisible();

  // Delete contact
  await visibleContacts.getByRole("button", { name: "Delete Sarah Connor" }).click();
  const deleteDialog = page.getByRole("dialog", { name: "Delete contact?" });
  await expect(deleteDialog).toBeVisible();
  await deleteDialog.getByRole("button", { name: "Delete contact" }).click();

  // Verify dialog closed and table updated immediately without page reload
  await expect(deleteDialog).not.toBeVisible();
  await expect(page.getByText("Contact deleted.")).toBeVisible();
  await expect(page.getByText("0 shown")).toBeVisible();
  await expect(visibleContacts.getByText("Sarah Connor")).not.toBeVisible();
  await expect(page.getByText("No contacts yet")).toBeVisible();

  api.assertNoUnexpectedRequests();
});
