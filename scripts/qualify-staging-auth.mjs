const productUrl = (process.env.STAGING_PRODUCT_URL ?? "https://staging.musicsite.org").replace(
  /\/$/,
  "",
);
const organizationSlugs = (process.env.STAGING_ORG_SLUGS ?? "lcc,lmc")
  .split(",")
  .map((slug) => slug.trim().toLowerCase())
  .filter(Boolean);
const sessionCookie = process.env.STAGING_SESSION_COOKIE?.trim();
const expectedEmail = process.env.STAGING_AUTH_EMAIL?.trim().toLowerCase() ?? "";

if (!sessionCookie) {
  console.error(
    "Set STAGING_SESSION_COOKIE to the session cookie from an authenticated staging login. " +
      "Do not paste the cookie into source control or chat.",
  );
  process.exit(2);
}

const productRoutes = [
  "/api/auth/get-session",
  "/api/account/organizations",
  "/api/account/security",
  "/api/platform/mfa/status",
];
const organizationRoutes = [
  "/api/auth/get-session",
  "/api/account/organizations",
  "/api/account/security",
  "/api/organization/context",
  "/api/organization/profiles",
  "/api/organization/profiles/export.csv",
  "/api/organization/members",
  "/api/organization/website",
  "/api/organization/tickets/orders",
  "/api/organization/tickets/bundles",
  "/api/organization/tickets/will-call",
  "/api/organization/donations",
  "/api/organization/patrons",
  "/api/organization/seasons",
  "/api/organization/dues",
  "/api/organization/resources",
  "/api/organization/communications",
  "/api/organization/communications/templates",
  "/api/organization/music",
  "/api/organization/music/export",
  "/api/organization/venues",
  "/api/organization/calendar-settings",
  "/api/organization/roster-configuration",
  "/api/organization/seating-configuration",
  "/api/organization/events",
  "/api/organization/dashboard-summary",
  "/api/organization/audition-settings",
  "/api/organization/auditions",
  "/api/organization/polls",
  "/api/organization/invitations",
  "/api/organization/auth-status",
  "/api/organization/public-domains",
  "/api/singer/profile",
  "/api/singer/directory",
  "/api/singer/music",
  "/api/singer/events",
  "/api/singer/calendar-feed-url",
];

// Routes that require a parameterized fixture (for example a ticketed event ID)
// and therefore correctly reject a bare request with 400.
const organizationValidationRoutes = new Set(["/api/organization/tickets/will-call"]);

const failures = [];
const counts = { product: 0, organizations: 0 };

async function request(url) {
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json,text/csv;q=0.9,*/*;q=0.8",
        "cache-control": "no-cache",
        cookie: sessionCookie,
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      // CSV responses are intentionally not JSON.
    }
    return { body, status: response.status };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error), status: 0 };
  }
}

function check(label, result, expected = 200) {
  if (result.status !== expected) {
    failures.push(`${label}: expected ${String(expected)}, received ${String(result.status)}`);
  }
  if (result.error) failures.push(`${label}: ${result.error}`);
}

const session = await request(`${productUrl}/api/auth/get-session`);
check("product GET /api/auth/get-session", session);
const sessionEmail = String(session.body?.user?.email ?? "").toLowerCase();
if (!sessionEmail) failures.push("authenticated session did not contain a user email");
if (expectedEmail && sessionEmail !== expectedEmail) {
  failures.push(`authenticated session email did not match ${expectedEmail}`);
}

for (const path of productRoutes.filter((path) => path !== "/api/auth/get-session")) {
  counts.product += 1;
  check(`product GET ${path}`, await request(`${productUrl}${path}`));
}

for (const slug of organizationSlugs) {
  const host = `https://${slug}.${new URL(productUrl).hostname}`;
  for (const path of organizationRoutes) {
    counts.organizations += 1;
    check(
      `${slug} GET ${path}`,
      await request(`${host}${path}`),
      organizationValidationRoutes.has(path) ? 400 : 200,
    );
  }
}

console.log(
  `Authenticated staging qualification: ${counts.product} product reads and ${counts.organizations} Organization-host reads; session identity ${sessionEmail || "unknown"}.`,
);
if (failures.length > 0) {
  console.error(`Authenticated qualification failed with ${String(failures.length)} issue(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    "Authenticated session, account, Platform MFA status, Organization reads, exports, and singer reads passed without mutations.",
  );
}
