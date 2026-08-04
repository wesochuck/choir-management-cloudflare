const productUrl = (
  process.env.DEPLOY_PRODUCT_URL ??
  process.env.STAGING_PRODUCT_URL ??
  "https://staging.musicsite.org"
).replace(/\/$/u, "");
const expectedEnvironment = process.env.DEPLOY_EXPECTED_ENVIRONMENT ?? "staging";
const expectedVersion = process.env.DEPLOY_EXPECTED_VERSION ?? process.env.STAGING_EXPECTED_VERSION;
const workerUrl = (process.env.DEPLOY_WORKER_URL ?? process.env.STAGING_WORKER_URL ?? "").replace(
  /\/$/u,
  "",
);
const organizationSlugs = (
  process.env.DEPLOY_ORG_SLUGS ??
  process.env.STAGING_ORG_SLUGS ??
  "lcc,lmc"
)
  .split(",")
  .map((slug) => slug.trim().toLowerCase())
  .filter(Boolean);
const attempts = Math.max(1, Number(process.env.STAGING_QUALIFY_ATTEMPTS ?? "6"));
const retryDelayMs = Math.max(0, Number(process.env.STAGING_QUALIFY_RETRY_MS ?? "2000"));

if (!expectedVersion)
  throw new Error("The expected release version is required for qualification.");

const productOrigin = new URL(productUrl);
const customDomainProbes = [
  { expected: "health", label: "product health", url: `${productUrl}/api/health` },
  { expected: "ready", label: "product readiness", url: `${productUrl}/api/ready` },
  ...organizationSlugs.map((slug) => ({
    expected: "health",
    label: `${slug} Organization health`,
    url: `${productOrigin.protocol}//${slug}.${productOrigin.hostname}/api/health`,
  })),
];
const workerProbes = workerUrl
  ? [
      { expected: "health", label: "deployed Worker health", url: `${workerUrl}/api/health` },
      { expected: "ready", label: "deployed Worker readiness", url: `${workerUrl}/api/ready` },
    ]
  : [];
const probes = [...workerProbes, ...customDomainProbes];
const qualifyUserAgent =
  process.env.STAGING_QUALIFY_USER_AGENT ??
  "Mozilla/5.0 (compatible; ChoirManagementReleaseQualification/1.0)";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function probe(entry) {
  const response = await fetch(entry.url, {
    headers: {
      accept: "application/json",
      "cache-control": "no-cache",
      "user-agent": qualifyUserAgent,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => undefined);

  // GitHub-hosted runners can be blocked by a Cloudflare edge rule before the
  // request reaches the Worker. Keep this distinct from a Worker failure so a
  // direct workers.dev probe can still prove the exact uploaded version.
  if (response.status === 403 && customDomainProbes.includes(entry)) {
    return { edgeBlocked: true };
  }
  if (response.status !== 200) {
    throw new Error(`${entry.label} returned HTTP ${String(response.status)}.`);
  }
  if (entry.expected === "ready") {
    if (body?.status !== "ready") throw new Error(`${entry.label} did not report ready.`);
    return;
  }
  if (body?.status !== "ok" || body?.environment !== expectedEnvironment) {
    throw new Error(`${entry.label} did not report healthy ${expectedEnvironment} state.`);
  }
  if (body?.version !== expectedVersion) {
    throw new Error(
      `${entry.label} serves ${String(body?.version)} instead of ${expectedVersion}.`,
    );
  }
}

let lastFailures = [];
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  const results = await Promise.allSettled(probes.map(probe));
  lastFailures = results.flatMap((result, index) =>
    result.status === "rejected"
      ? [
          `${probes[index].label}: ${
            result.reason instanceof Error ? result.reason.message : String(result.reason)
          }`,
        ]
      : [],
  );
  const edgeBlocked = results.flatMap((result, index) =>
    result.status === "fulfilled" && result.value?.edgeBlocked ? [probes[index].label] : [],
  );

  if (lastFailures.length === 0) {
    if (
      edgeBlocked.length > 0 &&
      edgeBlocked.length === customDomainProbes.length &&
      workerProbes.length > 0
    ) {
      console.warn(
        `Qualified Worker version ${expectedVersion} directly, but Cloudflare blocked all ${String(edgeBlocked.length)} custom-domain probes for this runner. Recheck custom-domain routing from an allowlisted or interactive network.`,
      );
      process.exit(0);
    }
    if (edgeBlocked.length === 0) {
      console.log(
        `Qualified Worker version ${expectedVersion} with ${String(probes.length)} API probes.`,
      );
      process.exit(0);
    }
    lastFailures = [
      `Only ${String(edgeBlocked.length)} of ${String(customDomainProbes.length)} custom-domain probes were blocked by the Cloudflare edge.`,
    ];
  }
  if (attempt < attempts) await delay(retryDelayMs);
}

console.error(`Release qualification failed after ${String(attempts)} attempts:`);
for (const failure of lastFailures) console.error(`- ${failure}`);
process.exitCode = 1;
