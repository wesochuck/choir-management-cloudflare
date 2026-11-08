import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";

const requestId = "99999999-9999-4999-8999-999999999999";
const importId = "11111111-1111-4111-8111-111111111111";
const listId = "33333333-3333-4333-8333-333333333333";
const timestamp = "2026-08-01T00:00:00.000Z";
const headers = [
  "Name",
  "Email",
  "Phone",
  "Source",
  "Email Status",
  "SMS Status",
  "Lists",
  "Updated At",
  "Extra column with a very long name",
];
const samples = [
  "Jane Contact",
  "jane@example.test",
  "+17404077415",
  "ticket_purchase",
  "unknown",
  "unknown",
  "",
  timestamp,
  "x".repeat(200),
];

for (const theme of ["light", "dark"] as const) {
  test(`contact import actions stay visible with wide columns in ${theme} theme`, async ({
    page,
  }, testInfo) => {
    await installOrganizationApi(page, { role: "administrator", strict: true });
    await page.route("**/api/organization/contacts?*", (route) =>
      route.fulfill({
        json: {
          contacts: [],
          preferences: [],
          memberships: [],
          hasMore: false,
          nextCursor: null,
          requestId,
        },
      }),
    );
    await page.route("**/api/organization/contact-lists", (route) =>
      route.fulfill({
        json: {
          lists: [
            {
              id: listId,
              name: "Newsletter",
              description: null,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
          ],
          requestId,
        },
      }),
    );
    await page.route("**/api/organization/contact-imports?*", (route) =>
      route.fulfill({
        json: {
          headers,
          importId,
          invalidRowCount: 0,
          probableDuplicateCount: 0,
          requestId,
          rowCount: 1,
          sampleRows: [samples],
          status: "staged",
        },
      }),
    );
    await page.route(`**/api/organization/contact-imports/${importId}/mapping`, (route) =>
      route.fulfill({
        json: {
          ...route.request().postDataJSON(),
          importId,
          requestId,
          status: "staged",
        },
      }),
    );
    await page.route(`**/api/organization/contact-imports/${importId}/preview`, (route) =>
      route.fulfill({
        json: {
          contactsCreated: 0,
          contactsUpdated: 0,
          existingMatches: 0,
          importId,
          inFileDuplicates: 0,
          invalidRows: 0,
          membershipsAdded: 0,
          newContacts: 1,
          requestId,
          rowsRead: 1,
          status: "staged",
          suppressedPreserved: 0,
        },
      }),
    );
    let confirmations = 0;
    await page.route(`**/api/organization/contact-imports/${importId}/confirm`, async (route) => {
      confirmations += 1;
      await route.fulfill({
        json: { idempotencyKey: "test-import", importId, requestId, status: "confirmed" },
      });
    });
    await page.route(`**/api/organization/contact-imports/${importId}`, (route) =>
      route.fulfill({
        json: {
          contactsCreated: 1,
          contactsUpdated: 0,
          existingMatches: 0,
          importId,
          inFileDuplicates: 0,
          invalidRows: 0,
          membershipsAdded: 1,
          newContacts: 1,
          requestId,
          rowsRead: 1,
          status: "completed",
          suppressedPreserved: 0,
          errorCode: null,
          hasErrorCsv: false,
          processedRows: 1,
        },
      }),
    );
    await page.addInitScript((preference) => {
      localStorage.setItem(`choir-theme:${location.hostname}`, preference);
    }, theme);
    await page.goto("/admin/contacts");
    await expect(page.locator(".signed-in-shell")).toHaveAttribute("data-theme", theme);
    await page.getByRole("button", { name: "Import CSV", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Import contacts from CSV", exact: true });
    await dialog.getByLabel("Choose a CSV file").setInputFiles({
      name: "contacts.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(`${headers.join(",")}\n${samples.join(",")}`),
    });
    const preview = dialog.getByRole("button", { name: "Preview import", exact: true });
    await expect(preview).toBeInViewport();
    await expect(preview).toBeDisabled();
    await dialog.getByText("Sample rows", { exact: true }).click();
    await expect(
      dialog.getByRole("combobox", { name: "Email", exact: false }).first(),
    ).toBeVisible();
    const layout = await dialog.evaluate((element) => {
      const body = element.querySelector(".dialog__body");
      const footer = element.querySelector(".dialog__footer");
      if (!body || !footer) throw new Error("Missing dialog layout");
      return {
        fits: body.scrollWidth <= body.clientWidth,
        footerOutsideBody: !body.contains(footer),
      };
    });
    expect(layout).toEqual({ fits: true, footerOutsideBody: true });
    await dialog.getByRole("checkbox", { name: "Newsletter", exact: true }).check();
    await expect(preview).toBeEnabled();
    await dialog.locator(".dialog__body").evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(preview).toBeInViewport();
    await dialog.screenshot({ path: testInfo.outputPath(`import-${theme}.png`) });
    expect(confirmations).toBe(0);
    await preview.focus();
    await page.keyboard.press("Enter");
    const confirm = dialog.getByRole("button", { name: "Confirm import", exact: true });
    await expect(confirm).toBeInViewport();
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await expect(dialog.getByRole("checkbox", { name: "Newsletter", exact: true })).toBeChecked();
    await preview.click();
    await confirm.click();
    await expect(dialog.getByRole("button", { name: "Done", exact: true })).toBeInViewport();
    expect(confirmations).toBe(1);
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).not.toBeVisible();
  });
}
