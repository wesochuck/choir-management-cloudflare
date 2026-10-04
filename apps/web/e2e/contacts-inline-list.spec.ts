import { contactSchema, type ContactList } from "@choir/contracts";
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
