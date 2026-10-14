import {
  buildAnonymousProbeRows,
  buildProbePlan,
  getApplicationRoutes,
  isExpectedAnonymousBoundary,
  materializeRoutePath,
  usesOrganizationHost,
} from "./route-probe-plan.mjs";

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
const anonymous = process.argv.includes("--anonymous");

if (!sessionCookie && !planOnly && !anonymous) {
  console.error(
    "Set STAGING_SESSION_COOKIE to the session cookie from an authenticated staging login. " +
      "Do not paste the cookie into source control or chat. Use --plan-only to preview the probe " +
      "plan or --anonymous for the no-session, empty-input boundary sweep.",
  );
  process.exit(2);
}

if (anonymous && planOnly) {
  console.error("Choose either --anonymous or --plan-only, not both.");
  process.exit(2);
}

if (anonymous && organizationSlugs.length === 0) {
  console.error("Set STAGING_ORG_SLUGS to at least one seeded Organization slug for --anonymous.");
  process.exit(2);
}

function hostFor(row, organizationSlug = organizationSlugs[0]) {
  if (usesOrganizationHost(row)) {
    const slug = organizationSlug;
    if (!slug) throw new Error("Set STAGING_ORG_SLUGS to at least one seeded Organization slug.");
    return `https://${slug}.${new URL(productUrl).hostname}`;
  }
  return productUrl;
}

async function request(url, method, cookie) {
  try {
    const origin = new URL(url).origin;
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "cache-control": "no-cache",
        ...(cookie ? { cookie } : {}),
        "content-type": "application/json",
        origin,
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      },
      method,
      ...(method === "GET" ? {} : { body: "{}" }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => null);
    return {
      code:
        typeof body === "object" && body !== null && "code" in body && typeof body.code === "string"
          ? body.code
          : undefined,
      status: response.status,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), status: 0 };
  }
}

if (anonymous) {
  const routes = await getApplicationRoutes();
  const rows = buildAnonymousProbeRows(routes, organizationSlugs);
  const statusCounts = new Map();
  let failed = 0;
  for (const row of rows) {
    const url = `${hostFor(row, row.organizationSlug)}${materializeRoutePath(row.route)}`;
    const method = row.method;
    const result = await request(url, method);
    const statusKey = String(result.status);
    statusCounts.set(statusKey, (statusCounts.get(statusKey) ?? 0) + 1);
    const passed = isExpectedAnonymousBoundary(row, result);
    const detail =
      result.error ?? `${String(result.status)}${result.code ? ` ${result.code}` : ""}`;
    const displayId = row.organizationSlug ? `${row.id}@${row.organizationSlug}` : row.id;
    console.log(`${passed ? "PASS" : "FAIL"} ${displayId.padEnd(50)} ${detail}`);
    if (!passed) failed += 1;
  }
  console.log(
    `\nAnonymous staging boundary: ${String(routes.length)} API routes across ${String(organizationSlugs.length)} seeded Organization host(s); ${String(rows.length)} safe requests; statuses ${[
      ...statusCounts.entries(),
    ]
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([status, count]) => `${status}=${String(count)}`)
      .join(", ")}.`,
  );
  if (failed > 0) process.exitCode = 1;
} else {
  const rows = buildProbePlan();
  const summary = { fail: 0, pass: 0, skip: 0 };
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
    const url = `${hostFor(row)}${materializeRoutePath(row.route)}`;
    const method = row.method;
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
    console.log(
      `${row.result.padEnd(30)} ${row.id.padEnd(42)} ${row.kind.padEnd(18)} ${row.route}`,
    );
  }
  if (!planOnly) {
    console.log(
      `\nStaging route evidence: ${String(summary.pass)} passed, ${String(summary.fail)} failed, ${String(summary.skip)} skipped across ${String(rows.length)} qualified API routes.`,
    );
  }
  if (failed > 0) process.exitCode = 1;
}
