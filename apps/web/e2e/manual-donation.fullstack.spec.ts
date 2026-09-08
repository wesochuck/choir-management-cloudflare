// FULL-STACK suite (reaches the real local Worker/D1/DO stack).
//
// A finance flow with no live provider: the donation is recorded through the
// real /admin/donations UI using an offline payment method (cash), so Stripe
// is never involved. The record is read back through the UI after a reload
// and through the live GET /api/organization/donations contract. No
// `page.route(...)` mocks are registered; the only test seam is the
// local-only bootstrap/login helper. Mocked donation-state coverage lives in
// the mocked donations specs.
import { expect, test } from "@playwright/test";
import { donationRecordsResponseSchema } from "@choir/contracts";
import { z } from "zod";
import {
  bootstrapFullstack,
  FULLSTACK_APP_ORIGIN,
  signInWithFullstackOtp,
  uniqueFullstackName,
} from "./fixtures/fullstack";

const FULLSTACK_DONATIONS_EMAIL = "fullstack.donations@example.test";

const problemSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  requestId: z.string().min(1),
});

test("records an offline donation that survives a reload @webkit-smoke", async ({
  page,
  request,
}) => {
  await bootstrapFullstack(request, FULLSTACK_DONATIONS_EMAIL);
  await signInWithFullstackOtp(page, request, FULLSTACK_DONATIONS_EMAIL);

  const donorName = uniqueFullstackName("Fullstack Donor");
  await page.goto(`${FULLSTACK_APP_ORIGIN}/admin/donations`);
  await page.getByRole("button", { name: "Record donation" }).click();
  const dialog = page.getByRole("dialog", { name: "Record donation" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Amount (USD)").fill("75");
  await dialog.getByRole("combobox", { name: "Donor name" }).fill(donorName);
  await dialog.getByLabel("Payment method").selectOption("cash");

  const manualRequest = page.waitForRequest(
    (entry) =>
      entry.method() === "POST" && entry.url().includes("/api/organization/donations/manual"),
  );
  await dialog.getByRole("button", { name: "Record donation" }).click();
  await manualRequest;

  await expect(page.getByRole("status")).toHaveText("Manual donation recorded.");
  await expect(dialog).toBeHidden();
  const historyPanel = page.getByRole("tabpanel", { name: /history/i });
  await expect(historyPanel.getByText(donorName)).toBeVisible();

  // The live read contract must agree with the UI. A Worker regression that
  // drops or renames donation fields fails this parse.
  const listed = await page.request.get(`${FULLSTACK_APP_ORIGIN}/api/organization/donations`);
  expect(listed.ok()).toBe(true);
  const donationsBody = donationRecordsResponseSchema.parse(await listed.json());
  const created = donationsBody.donations.find((donation) => donation.buyerName === donorName);
  expect(created).toMatchObject({ amountCents: 7500, paymentMethod: "cash", status: "paid" });

  await page.reload();
  await expect(page.getByRole("tabpanel", { name: /history/i }).getByText(donorName)).toBeVisible();
});

test("rejects invalid manual-donation payloads with typed failures", async ({ page, request }) => {
  await bootstrapFullstack(request);

  // Anonymous callers cannot reach the mutation at all.
  const anonymous = await request.post(
    `${FULLSTACK_APP_ORIGIN}/api/organization/donations/manual`,
    { data: {}, headers: { origin: FULLSTACK_APP_ORIGIN } },
  );
  expect(anonymous.status()).toBe(401);

  // Contract-drift proof: an authenticated empty payload must stay a 400
  // `validation_failed`, never a donation with invented defaults.
  await signInWithFullstackOtp(page, request, FULLSTACK_DONATIONS_EMAIL);
  const invalid = await page.request.post(
    `${FULLSTACK_APP_ORIGIN}/api/organization/donations/manual`,
    {
      data: {},
      headers: { origin: FULLSTACK_APP_ORIGIN },
    },
  );
  expect(invalid.status()).toBe(400);
  expect(problemSchema.parse(await invalid.json()).code).toBe("validation_failed");
});
