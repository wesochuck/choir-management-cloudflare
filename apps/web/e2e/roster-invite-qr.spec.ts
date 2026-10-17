import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import jsQR from "jsqr";
import { installOrganizationApi } from "./fixtures/apiMocks";

const requestId = "11111111-1111-4111-8111-111111111111";
const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
// Synthetic credential: make sure the QR preserves the complete fragment, even for dense links.
const shareUrl = `https://alpha.example.test/join-roster#token=test-${"abcdefgh".repeat(50)}`;
const activeLink = {
  id: "invite-qr",
  label: "Community rehearsal",
  status: "active",
  maxUses: 20,
  committedUses: 1,
  activeReservations: 0,
  createdByUserId: "user-admin",
  organizationId: "organization-alpha",
  createdAt: new Date().toISOString(),
  expiresAt,
  revokedAt: null,
};

for (const logo of ["present", "missing"] as const) {
  test(`downloads a scannable roster invite PNG with Organization logo ${logo}`, async ({
    page,
  }) => {
    const api = await installOrganizationApi(page, { role: "administrator", strict: true });
    await page.route("**/api/organization/members", (route) =>
      route.fulfill({ json: { memberships: [], truncated: false, requestId } }),
    );
    await page.route("**/api/organization/roster-invite-links", (route) =>
      route.fulfill({
        json: {
          links: [
            activeLink,
            { ...activeLink, id: "expired-invite", label: "Old rehearsal", status: "expired" },
          ],
          requestId,
        },
      }),
    );
    let shares = 0;
    await page.route("**/api/organization/roster-invite-links/invite-qr/share", (route) => {
      expect(route.request().method()).toBe("POST");
      shares += 1;
      return route.fulfill({ json: { id: activeLink.id, shareUrl, expiresAt, requestId } });
    });
    await page.route("**/api/public/logo", (route) =>
      logo === "present"
        ? route.fulfill({
            contentType: "image/svg+xml",
            body: '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#e00040"/></svg>',
          })
        : route.fulfill({ status: 404 }),
    );
    await page.goto("/admin/roster");
    await page.getByRole("button", { name: "Invite by link", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Roster invite links", exact: true });
    const buttons = dialog
      .getByRole("button", { name: "Download QR code", exact: true })
      .filter({ visible: true });
    await expect(buttons).toHaveCount(1);
    const downloading = page.waitForEvent("download");
    await buttons.click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/roster_invite_qr.*\.png$/);
    const path = await download.path();
    if (!path) throw new Error("The PNG download was not saved.");
    const png = await readFile(path);
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const pixels = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas is unavailable.");
      context.drawImage(image, 0, 0);
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height);
      let logoPixels = 0;
      for (let i = 0; i < rgba.data.length; i += 4) {
        if (
          (rgba.data[i] ?? 0) > 180 &&
          (rgba.data[i + 1] ?? 255) < 70 &&
          (rgba.data[i + 2] ?? 255) < 100
        )
          logoPixels += 1;
      }
      return {
        data: Array.from(rgba.data),
        width: canvas.width,
        height: canvas.height,
        logoPixels,
      };
    }, png.toString("base64"));
    expect(jsQR(Uint8ClampedArray.from(pixels.data), pixels.width, pixels.height)?.data).toBe(
      shareUrl,
    );
    expect(pixels.width).toBeGreaterThanOrEqual(512);
    if (logo === "present") expect(pixels.logoPixels).toBeGreaterThan(50);
    else expect(pixels.logoPixels).toBe(0);
    expect(shares).toBe(1);
    await expect(dialog.getByRole("status")).toContainText("QR image downloaded");
    await expect(buttons).toBeEnabled();
    expect(
      await dialog
        .locator(".dialog__body")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    api.assertNoUnexpectedRequests();
  });
}
