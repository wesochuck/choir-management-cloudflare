import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { buildProbePlan } from "./parity-evidence-plan.mjs";

const productUrl = (process.env.STAGING_PRODUCT_URL ?? "https://staging.musicsite.org").replace(
  /\/$/,
  "",
);
const organizationSlugs = (process.env.STAGING_ORG_SLUGS ?? "lcc,lmc")
  .split(",")
  .map((slug) => slug.trim().toLowerCase())
  .filter(Boolean);
const sessionCookie = process.env.STAGING_SESSION_COOKIE?.trim();
const planOnly = process.argv.includes("--plan-only");

if (!sessionCookie && !planOnly) {
  console.error(
    "Set STAGING_SESSION_COOKIE to the session cookie from an authenticated staging login. " +
      "Do not paste the cookie into source control or chat. Use --plan-only to preview the probe plan.",
  );
  process.exit(2);
}

const matrixUrl = new URL("../docs/parity/feature-matrix.yaml", import.meta.url);
const matrix = parse(await readFile(matrixUrl, "utf8"));

function hostFor(row) {
  if (row.route.startsWith("/api/organization/") || row.route.startsWith("/api/singer/")) {
    const slug = organizationSlugs[0];
    if (!slug) throw new Error("Set STAGING_ORG_SLUGS to at least one seeded Organization slug.");
    return `https://${slug}.${new URL(productUrl).hostname}`;
  }
  return productUrl;
}

async function request(url, method, cookie) {
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "cache-control": "no-cache",
        ...(cookie ? { cookie } : {}),
        "content-type": "application/json",
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      },
      method,
      ...(method === "GET" ? {} : { body: "{}" }),
      signal: AbortSignal.timeout(15_000),
    });
    return { status: response.status };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), status: 0 };
  }
}

const rows = buildProbePlan(matrix);
const summary = { pass: 0, fail: 0, skip: 0 };
let failed = 0;

for (const row of rows) {
  if (row.kind.startsWith("skip")) {
    row.result = "SKIP";
    summary.skip += 1;
    continue;
  }
  if (planOnly) {
    row.result = "PLANNED";
    continue;
  }
  const url = `${hostFor(row)}${row.route}`;
  const method = row.method === "GET" ? "GET" : "POST";
  const cookie = row.kind === "read-anon" ? undefined : sessionCookie;
  const result = await request(url, method, cookie);
  const passed = result.error === undefined && result.status === row.expected;
  row.result =
    result.error !== undefined
      ? `FAIL (${result.error})`
      : passed
        ? "PASS"
        : `FAIL (${String(result.status)})`;
  if (passed) summary.pass += 1;
  else {
    summary.fail += 1;
    failed += 1;
  }
}

for (const row of rows) {
  console.log(`${row.result.padEnd(30)} ${row.id.padEnd(42)} ${row.kind.padEnd(18)} ${row.route}`);
}
if (!planOnly) {
  console.log(
    `\nParity staging evidence: ${String(summary.pass)} passed, ${String(summary.fail)} failed, ${String(summary.skip)} skipped across ${String(rows.length)} implemented API entries.`,
  );
}
if (failed > 0) process.exitCode = 1;
