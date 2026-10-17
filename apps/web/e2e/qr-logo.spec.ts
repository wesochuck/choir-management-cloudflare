import { expect, test } from "@playwright/test";
import jsQR from "jsqr";
import {
  receiptResponse,
  routePublicBasics,
  scanToken,
  successToken,
} from "./support/ticketingFixtures";

const logos = [
  { name: "square", width: 120, height: 120 },
  { name: "wide transparent", width: 240, height: 60 },
  { name: "tall", width: 60, height: 240 },
  { name: "dense token", width: 120, height: 120 },
  { name: "decoder rejected", width: 120, height: 120 },
];

for (const logo of [
  ...logos,
  { name: "missing", width: 0, height: 0 },
  { name: "broken", width: 0, height: 0 },
]) {
  test(`ticket QR decodes with ${logo.name} Organization logo`, async ({ page }, testInfo) => {
    const token = logo.name === "dense token" ? `scan-${"abcdefgh".repeat(80)}` : scanToken;
    await routePublicBasics(page);
    if (logo.name === "decoder rejected") {
      await page.route("**/assets/jsQR-*.js", (route) =>
        route.fulfill({
          contentType: "application/javascript",
          body: "export default function () { return null; }",
        }),
      );
    }
    await page.route("**/api/public/tickets/order*", (route) =>
      route.fulfill({ json: { ...receiptResponse, scanToken: token } }),
    );
    await page.route("**/api/public/logo", (route) =>
      logo.name === "missing"
        ? route.fulfill({ status: 404 })
        : route.fulfill({
            contentType: "image/svg+xml",
            body:
              logo.name === "broken"
                ? "broken-image"
                : `<svg xmlns="http://www.w3.org/2000/svg" width="${String(logo.width)}" height="${String(logo.height)}"><rect x="4" y="4" width="${String(logo.width - 8)}" height="${String(logo.height - 8)}" fill="#e00040"/></svg>`,
          }),
    );
    await page.goto(`/tickets/order/success?token=${successToken}`);
    const qr = page.getByRole("img", { name: /Admission QR code/ });
    await expect(qr).toBeVisible();
    const pixels = await qr.evaluate((element) => {
      if (!(element instanceof HTMLImageElement)) throw new Error("Expected QR image");
      const canvas = document.createElement("canvas");
      canvas.width = element.naturalWidth;
      canvas.height = element.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Missing canvas");
      context.drawImage(element, 0, 0);
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
      return { data: Array.from(rgba.data), width: rgba.width, height: rgba.height, logoPixels };
    });
    expect(jsQR(Uint8ClampedArray.from(pixels.data), pixels.width, pixels.height)?.data).toBe(
      token,
    );
    if (logo.width > 0 && logo.name !== "decoder rejected")
      expect(pixels.logoPixels).toBeGreaterThan(50);
    else expect(pixels.logoPixels).toBe(0);
    if (logo.name === "square")
      await qr.screenshot({ path: testInfo.outputPath("branded-qr.png") });
    await expect(page).toHaveURL(new RegExp(`token=${successToken}$`));
  });
}
