import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const baselineUrl = process.env.BASELINE_URL ?? "http://127.0.0.1:4174";
const outputDirectory = resolve("docs/parity/screenshots");
const enabledModules = [
  "attendance",
  "auditions",
  "communications",
  "directory",
  "donations",
  "events",
  "musicLibrary",
  "patrons",
  "polls",
  "publicWebsite",
  "reports",
  "resources",
  "roster",
  "rsvps",
  "seating",
  "setLists",
  "ticketSales",
];

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });

async function capture({ fileName, path, setupState, viewport }) {
  const page = await browser.newPage({ colorScheme: "light", viewport });
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/setup/status") {
      await route.fulfill({
        body: JSON.stringify({
          completedSections: [],
          initialized: setupState === "initialized",
          state: setupState,
        }),
        contentType: "application/json",
      });
      return;
    }
    if (pathname === "/api/modules/state") {
      await route.fulfill({
        body: JSON.stringify({ enabled: enabledModules }),
        contentType: "application/json",
      });
      return;
    }
    await route.fulfill({
      body: JSON.stringify({ items: [], page: 1, perPage: 30, totalItems: 0, totalPages: 0 }),
      contentType: "application/json",
    });
  });
  await page.goto(new URL(path, baselineUrl).href, { waitUntil: "networkidle" });
  await page.screenshot({
    fullPage: true,
    path: resolve(outputDirectory, fileName),
  });
  await page.close();
}

const captures = [
  {
    fileName: "baseline-login-desktop.png",
    path: "/login",
    setupState: "initialized",
    viewport: { height: 900, width: 1440 },
  },
  {
    fileName: "baseline-login-mobile.png",
    path: "/login",
    setupState: "initialized",
    viewport: { height: 844, width: 390 },
  },
  {
    fileName: "baseline-setup-desktop.png",
    path: "/setup",
    setupState: "unclaimed",
    viewport: { height: 900, width: 1440 },
  },
  {
    fileName: "baseline-setup-mobile.png",
    path: "/setup",
    setupState: "unclaimed",
    viewport: { height: 844, width: 390 },
  },
  {
    fileName: "baseline-public-home-desktop.png",
    path: "/",
    setupState: "initialized",
    viewport: { height: 900, width: 1440 },
  },
  {
    fileName: "baseline-public-home-mobile.png",
    path: "/",
    setupState: "initialized",
    viewport: { height: 844, width: 390 },
  },
];

try {
  for (const captureDefinition of captures) {
    await capture(captureDefinition);
  }
} finally {
  await browser.close();
}

console.log(`Captured ${captures.length} baseline screenshots from ${baselineUrl}.`);
