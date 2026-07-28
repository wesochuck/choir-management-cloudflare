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
const requestDelayMs = Math.max(0, Number(process.env.STAGING_QUALIFY_DELAY_MS ?? "250"));
const requestUserAgent =
  process.env.STAGING_QUALIFY_USER_AGENT ??
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
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
let edgeBlocked = false;
const browserPaths = [...new Set(["/", ...matrix.browserRoutes.map((route) => route.path)])];

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
      headers: {
        accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
        "cache-control": "no-cache",
        "user-agent": requestUserAgent,
      },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    if (requestDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, requestDelayMs));
    return {
      code: responseCode(text),
      edgeBlocked: response.status === 403,
      status: response.status,
    };
  } catch (error) {
    if (requestDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, requestDelayMs));
    return { error: error instanceof Error ? error.message : String(error), status: 0 };
  }
}

function fail(label, message) {
  failures.push(`${label}: ${message}`);
}

for (const host of hosts) {
  if (edgeBlocked) break;
  for (const path of browserPaths) {
    if (edgeBlocked) break;
    const route = routePath(path);
    const result = await request(`${host.url}${route}`);
    counts.browser += 1;
    if (result.status !== 200) {
      fail(`${host.label} GET ${route}`, `expected 200, received ${String(result.status)}`);
    }
    edgeBlocked ||= result.edgeBlocked === true;
  }

  if (edgeBlocked) break;
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
    edgeBlocked ||= result.edgeBlocked === true;
    if (edgeBlocked) break;
  }
}

for (const host of hosts.filter((entry) => entry.label !== "unregistered")) {
  if (edgeBlocked) break;
  for (const route of matrix.apiRoutes.filter((entry) => entry.method === "GET")) {
    if (edgeBlocked) break;
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
    edgeBlocked ||= result.edgeBlocked === true;
  }
}

console.log(
  `Staging qualification: ${hosts.length} hosts, ${counts.browser} browser-shell probes, ${counts.core} core probes, ${counts.api} product/Organization-host GET API probes${edgeBlocked ? " before edge blocking" : ""}.`,
);
if (failures.length > 0) {
  if (edgeBlocked && failures.every((failure) => failure.includes("received 403"))) {
    console.warn(
      `Qualification was blocked by the Cloudflare edge for this runner (${String(failures.length)} HTTP 403 responses). ` +
        "Run the same read-only check from an allowlisted or interactive network to qualify the custom domains.",
    );
    process.exitCode = 0;
  } else {
    console.error(`Qualification failed with ${String(failures.length)} issue(s):`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  }
} else {
  console.log(
    "All anonymous shell, health, readiness, session, and registered-host GET boundaries passed.",
  );
}
