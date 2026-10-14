import { expect, test } from "@playwright/test";
import { installOrganizationApi } from "./fixtures/apiMocks";
import { fulfillJson } from "./fixtures/session";

const requestId = "99999999-9999-4999-8999-999999999999";

const complianceAssignees = [
  {
    email: "sarah.treasurer@example.test",
    membershipId: "11111111-1111-4111-8111-111111111111",
    name: "Sarah Treasurer",
    role: "admin",
    userId: "user-treasurer-1",
  },
];

const complianceTasks = [
  {
    applicable: true,
    archived: false,
    description: "Annual IRS filing for 501(c)(3) status.",
    id: "11111111-1111-4111-8111-111111111111",
    kind: "irs_annual_return",
    lastCompletedByName: null,
    lastCompletedDate: null,
    nextDueDate: "2026-11-15",
    nextReminderAt: "2026-10-18T00:00:00.000Z",
    recurrenceMonths: 12,
    referenceUrl: null,
    reminderIntervalDays: 7,
    responsibleEmail: "sarah.treasurer@example.test",
    responsibleMembershipId: "11111111-1111-4111-8111-111111111111",
    responsibleName: "Sarah Treasurer",
    responsibleNeedsReassignment: false,
    responsibleUserId: "user-treasurer-1",
    source: "builtin" as const,
    templateKey: "irs_annual_return",
    title: "IRS annual return",
  },
  {
    applicable: true,
    archived: false,
    description: "Review unclaimed funds annually.",
    id: "22222222-2222-4222-8222-222222222222",
    kind: "ohio_unclaimed_funds_annual_report",
    lastCompletedByName: "Jordan Smith",
    lastCompletedDate: "2025-10-25",
    nextDueDate: "2026-10-31",
    nextReminderAt: "2026-10-03T00:00:00.000Z",
    recurrenceMonths: 12,
    referenceUrl: "https://unclaimedfunds.ohio.gov/app/submit-a-report",
    reminderIntervalDays: 7,
    responsibleEmail: "sarah.treasurer@example.test",
    responsibleMembershipId: "11111111-1111-4111-8111-111111111111",
    responsibleName: "Sarah Treasurer",
    responsibleNeedsReassignment: false,
    responsibleUserId: "user-treasurer-1",
    source: "builtin" as const,
    templateKey: "ohio_unclaimed_funds_annual_report",
    title: "Ohio Annual Unclaimed Funds Report (including negative reports)",
  },
  {
    applicable: true,
    archived: false,
    description: "Annual report to Ohio Attorney General.",
    id: "33333333-3333-4333-8333-333333333333",
    kind: "ohio_ag_annual_report",
    lastCompletedByName: null,
    lastCompletedDate: null,
    nextDueDate: "2026-12-15",
    nextReminderAt: "2026-11-17T00:00:00.000Z",
    recurrenceMonths: 12,
    referenceUrl: null,
    reminderIntervalDays: 7,
    responsibleEmail: null,
    responsibleMembershipId: null,
    responsibleName: null,
    responsibleNeedsReassignment: false,
    responsibleUserId: null,
    source: "builtin" as const,
    templateKey: "ohio_ag_annual_report",
    title: "Ohio Charitable Annual Report",
  },
  {
    applicable: true,
    archived: false,
    description: "Renew performance venue liability policy.",
    id: "44444444-4444-4444-8444-444444444444",
    kind: null,
    lastCompletedByName: null,
    lastCompletedDate: null,
    nextDueDate: "2027-01-15",
    nextReminderAt: "2026-12-18T00:00:00.000Z",
    recurrenceMonths: 12,
    referenceUrl: null,
    reminderIntervalDays: 7,
    responsibleEmail: null,
    responsibleMembershipId: null,
    responsibleName: null,
    responsibleNeedsReassignment: false,
    responsibleUserId: null,
    source: "custom" as const,
    templateKey: null,
    title: "Venue insurance policy renewal",
  },
];

test.describe("Nonprofit compliance table layout and row-action alignment (Issue #221)", () => {
  test.beforeEach(async ({ page }) => {
    await installOrganizationApi(page);
    await page.route("**/api/organization/compliance", async (route) => {
      if (route.request().method() === "GET") {
        await fulfillJson(route, {
          enabled: true,
          requestId,
          tasks: complianceTasks,
        });
      } else {
        await route.fallback();
      }
    });
    await page.route("**/api/organization/compliance/assignees", async (route) => {
      await fulfillJson(route, {
        assignees: complianceAssignees,
        requestId,
      });
    });
  });

  test("aligns table cell content along the top on desktop, including tall Ohio row", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/admin/settings");

    const table = page.locator(".compliance-tasks-table table");
    await expect(table).toBeVisible();

    const rows = table.locator("tbody tr");
    await expect(rows).toHaveCount(4);

    // Verify cell top alignment for each row
    const rowCount = await rows.count();
    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const cells = row.locator("td");
      const cellTops = await cells.evaluateAll((tds) =>
        tds.map((td) => {
          const firstChild = td.firstElementChild ?? td;
          return Math.round(firstChild.getBoundingClientRect().top);
        }),
      );

      // In every row, key content starts along the top edge (within 6px tolerance
      // accounting for slight padding differences between pills, text, and buttons)
      const minTop = Math.min(...cellTops);
      const maxTop = Math.max(...cellTops);
      expect(maxTop - minTop).toBeLessThanOrEqual(6);
    }

    // Verify action button ordering in desktop rows
    // Row 0 (builtin): Mark completed above Edit
    const row0Actions = rows.nth(0).locator(".compliance-task-actions button");
    await expect(row0Actions).toHaveCount(2);
    await expect(row0Actions.nth(0)).toHaveText("Mark completed");
    await expect(row0Actions.nth(1)).toHaveText("Edit");

    // Row 3 (custom): Mark completed above Edit above Archive
    const customRowActions = rows.nth(3).locator(".compliance-task-actions button");
    await expect(customRowActions).toHaveCount(3);
    await expect(customRowActions.nth(0)).toHaveText("Mark completed");
    await expect(customRowActions.nth(1)).toHaveText("Edit");
    await expect(customRowActions.nth(2)).toHaveText("Archive");

    // Verify Ohio unclaimed funds disclosure
    const ohioRow = rows.filter({ hasText: "Ohio Annual Unclaimed Funds Report" });
    await expect(ohioRow).toHaveCount(1);

    const cue = ohioRow.getByText("Oct 31 is a suggested date — confirm applicability.");
    await expect(cue).toBeVisible();

    const disclosure = ohioRow.locator(".compliance-requirement__disclosure");
    await expect(disclosure).toBeVisible();

    // Disclosure summary is visible and clickable
    const summary = disclosure.locator("summary");
    await expect(summary).toHaveText("Filing guidance and references");

    // Before clicking summary, guidance paragraph is not visible
    const guidance = disclosure.getByText(/Suggested date only \(October 31 target\)/);
    await expect(guidance).not.toBeVisible();

    // Click summary to expand
    await summary.click();
    await expect(guidance).toBeVisible();
    await expect(disclosure.getByRole("link", { name: "Ohio holder reporting" })).toBeVisible();
    await expect(disclosure.getByRole("link", { name: "ORC 169.03" })).toBeVisible();

    // Click summary to collapse
    await summary.click();
    await expect(guidance).not.toBeVisible();
  });

  test("converts cleanly to mobile cards without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/settings");

    const cards = page.locator(".compliance-tasks-table .data-table-card");
    await expect(cards).toHaveCount(4);

    // Verify no horizontal overflow
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasOverflow).toBe(false);

    // Custom card actions wrap horizontally on mobile
    const customCardActions = cards.nth(3).locator(".compliance-task-actions");
    await expect(customCardActions.locator("button")).toHaveCount(3);
  });
});
