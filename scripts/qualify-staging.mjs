import { readFile } from "node:fs/promises";

import { parse } from "yaml";

const matrix = parse(
  await readFile(new URL("../docs/parity/feature-matrix.yaml", import.meta.url), "utf8"),
);
const productUrl = (process.env.STAGING_PRODUCT_URL ?? "https://staging.musicsite.org").replace(
  /\/$/,
  "",
);
const productOrigin = new URL(productUrl);
const organizationSlugs = (process.env.STAGING_ORG_SLUGS ?? "lcc,lmc")
  .split(",")
  .map((slug) => slug.trim().toLowerCase())
  .filter(Boolean);
const unregisteredUrl = (process.env.STAGING_UNREGISTERED_URL ?? "").replace(/\/$/, "");
const organizationUrls = organizationSlugs.map((slug) => ({
  label: slug,
  url: `${productOrigin.protocol}//${slug}.${productOrigin.hostname}`,
}));
const hosts = [{ label: "product", url: productUrl }, ...organizationUrls];
if (unregisteredUrl) hosts.push({ label: "unregistered", url: unregisteredUrl });

const placeholderId = "00000000-0000-4000-8000-000000000000";
const expectedRegistered404 = new Set([
  "GET /api/calendar/download",
  "GET /api/calendar/feed",
  "GET /api/player-playlist",
  "GET /api/tickets/scan-context",
]);
const failures = [];
const counts = { browser: 0, api: 0, core: 0 };

function routePath(path) {
  return path.replace(/:([A-Za-z0-9_]+)/g, placeholderId);
}

function responseCode(text) {
  try {
    const body = JSON.parse(text);
    return typeof body?.code === "string" ? body.code : "";
  } catch {
    return "";
  }
}

async function request(url) {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", "cache-control": "no-cache" },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    return { code: responseCode(text), status: response.status };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), status: 0 };
  }
}

function fail(label, message) {
  failures.push(`${label}: ${message}`);
}

for (const host of hosts) {
  for (const path of ["/", ...matrix.browserRoutes.map((route) => route.path)]) {
    const route = routePath(path);
    const result = await request(`${host.url}${route}`);
    counts.browser += 1;
    if (result.status !== 200) {
      fail(`${host.label} GET ${route}`, `expected 200, received ${String(result.status)}`);
    }
  }

  for (const path of ["/api/health", "/api/ready", "/api/auth/get-session"]) {
    const result = await request(`${host.url}${path}`);
    counts.core += 1;
    const expectedStatus =
      host.label === "unregistered" && path === "/api/auth/get-session" ? 404 : 200;
    if (result.status !== expectedStatus) {
      fail(
        `${host.label} GET ${path}`,
        `expected ${String(expectedStatus)}, received ${String(result.status)}`,
      );
    }
  }
}

for (const host of hosts.filter((entry) => entry.label !== "unregistered")) {
  for (const route of matrix.apiRoutes.filter((entry) => entry.method === "GET")) {
    const path = routePath(route.path);
    const methodPath = `GET ${path}`;
    const result = await request(`${host.url}${path}`);
    counts.api += 1;
    if (result.status >= 500) {
      fail(`${host.label} ${methodPath}`, `unexpected server error ${String(result.status)}`);
    }
    if (
      host.label !== "product" &&
      result.status === 404 &&
      !expectedRegistered404.has(methodPath)
    ) {
      fail(
        `${host.label} ${methodPath}`,
        `unexpected tenant-route 404 (${result.code || "no code"})`,
      );
    }
  }
}

console.log(
  `Staging qualification: ${hosts.length} hosts, ${counts.browser} browser-shell probes, ${counts.core} core probes, ${counts.api} product/Organization-host GET API probes.`,
);
if (failures.length > 0) {
  console.error(`Qualification failed with ${String(failures.length)} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    "All anonymous shell, health, readiness, session, and registered-host GET boundaries passed.",
  );
}
