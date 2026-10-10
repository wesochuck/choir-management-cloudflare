import { pathToFileURL } from "node:url";

export function buildProbes(options = {}) {
  const env = options.env ?? process.env;
  const productUrl = (
    options.productUrl ??
    env.DEPLOY_PRODUCT_URL ??
    env.STAGING_PRODUCT_URL ??
    "https://staging.musicsite.org"
  ).replace(/\/$/u, "");
  const workerUrl = (
    options.workerUrl ??
    env.DEPLOY_WORKER_URL ??
    env.STAGING_WORKER_URL ??
    ""
  ).replace(/\/$/u, "");
  const organizationSlugs =
    options.organizationSlugs ??
    (env.DEPLOY_ORG_SLUGS ?? env.STAGING_ORG_SLUGS ?? "lcc,lmc")
      .split(",")
      .map((slug) => slug.trim().toLowerCase())
      .filter(Boolean);

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

  return { customDomainProbes, probes, workerProbes };
}

export function evaluateAttempt(results, probes, customDomainProbes, workerProbes) {
  const failures = results.flatMap((result, index) => {
    if (result.status === "fulfilled" && !result.value?.failure) return [];
    const reason =
      result.status === "rejected"
        ? result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)
        : result.value.failure;
    return [{ label: probes[index].label, reason }];
  });

  const edgeBlocked = results.flatMap((result, index) =>
    result.status === "fulfilled" && result.value?.edgeBlocked ? [probes[index].label] : [],
  );

  const workerFailures = failures.filter((failure) => failure.label.startsWith("deployed Worker"));
  const directWorkerPassed = workerProbes.length > 0 && workerFailures.length === 0;

  const isVersionMismatch = (reason) => /serves .* instead of .*\.$/u.test(reason);
  const propagationDelay =
    failures.length > 0 && failures.every((failure) => isVersionMismatch(failure.reason));

  const allEdgeBlocked =
    edgeBlocked.length > 0 &&
    edgeBlocked.length === customDomainProbes.length &&
    workerProbes.length > 0;

  const qualified = failures.length === 0 && (edgeBlocked.length === 0 || allEdgeBlocked);

  return {
    allEdgeBlocked,
    directWorkerPassed,
    edgeBlocked,
    failures,
    propagationDelay,
    qualified,
  };
}

export async function probe(entry, options = {}) {
  const fetcher = options.fetcher ?? fetch;
  const qualifyUserAgent =
    options.qualifyUserAgent ??
    process.env.STAGING_QUALIFY_USER_AGENT ??
    "Mozilla/5.0 (compatible; ChoirManagementReleaseQualification/1.0)";
  const expectedEnvironment = options.expectedEnvironment ?? "staging";
  const expectedVersion = options.expectedVersion;
  const customDomainProbes = options.customDomainProbes ?? [];

  const response = await fetcher(entry.url, {
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
  const isCustomDomain =
    customDomainProbes.includes(entry) ||
    customDomainProbes.some((candidate) => candidate.url === entry.url);
  if (response.status === 403 && isCustomDomain) {
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

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runQualification(options = {}) {
  const env = options.env ?? process.env;
  const expectedEnvironment =
    options.expectedEnvironment ?? env.DEPLOY_EXPECTED_ENVIRONMENT ?? "staging";
  const expectedVersion =
    options.expectedVersion ?? env.DEPLOY_EXPECTED_VERSION ?? env.STAGING_EXPECTED_VERSION;
  const attempts = Math.max(1, Number(options.attempts ?? env.STAGING_QUALIFY_ATTEMPTS ?? "6"));
  const retryDelayMs = Math.max(
    0,
    Number(options.retryDelayMs ?? env.STAGING_QUALIFY_RETRY_MS ?? "2000"),
  );
  const fetcher = options.fetcher ?? fetch;
  const sleeper = options.sleeper ?? delay;
  const logger = options.logger ?? console;

  if (!expectedVersion) {
    throw new Error("The expected release version is required for qualification.");
  }

  const { customDomainProbes, probes, workerProbes } = buildProbes({
    env,
    organizationSlugs: options.organizationSlugs,
    productUrl: options.productUrl,
    workerUrl: options.workerUrl,
  });

  const probeOptions = {
    customDomainProbes,
    expectedEnvironment,
    expectedVersion,
    fetcher,
    qualifyUserAgent: options.qualifyUserAgent ?? env.STAGING_QUALIFY_USER_AGENT,
  };

  let lastEvaluation = null;
  let lastFailures = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const results = await Promise.allSettled(probes.map((entry) => probe(entry, probeOptions)));
    const evaluation = evaluateAttempt(results, probes, customDomainProbes, workerProbes);
    lastEvaluation = evaluation;

    if (evaluation.failures.length > 0) {
      lastFailures = evaluation.failures.map((failure) => `${failure.label}: ${failure.reason}`);
    } else if (
      evaluation.edgeBlocked.length > 0 &&
      (!evaluation.allEdgeBlocked || workerProbes.length === 0)
    ) {
      lastFailures =
        workerProbes.length === 0 && evaluation.edgeBlocked.length === customDomainProbes.length
          ? [
              `All ${String(evaluation.edgeBlocked.length)} custom-domain probes were blocked by Cloudflare edge rules and no direct Worker probes were configured to qualify the release.`,
            ]
          : [
              `Only ${String(evaluation.edgeBlocked.length)} of ${String(customDomainProbes.length)} custom-domain probes were blocked by the Cloudflare edge.`,
            ];
    } else {
      lastFailures = [];
    }

    if (evaluation.qualified) {
      if (evaluation.allEdgeBlocked) {
        logger.warn(
          `Qualified Worker version ${expectedVersion} directly, but Cloudflare blocked all ${String(evaluation.edgeBlocked.length)} custom-domain probes for this runner. Recheck custom-domain routing from an allowlisted or interactive network.`,
        );
        return { degraded: true, exitCode: 0, qualified: true, success: true };
      }
      logger.log(
        `Qualified Worker version ${expectedVersion} with ${String(probes.length)} API probes.`,
      );
      return { degraded: false, exitCode: 0, qualified: true, success: true };
    }

    if (attempt < attempts) {
      await sleeper(retryDelayMs);
    }
  }

  if (lastEvaluation?.propagationDelay) {
    if (lastEvaluation.directWorkerPassed) {
      logger.warn(
        `Qualified Worker version ${expectedVersion} directly on deployed Worker probes, but custom-domain probes kept reporting a healthy previous version. ` +
          "The rollout may still be propagating to custom domains, so traffic is left in place and staging is NOT rolled back. " +
          "Recheck custom-domain routing from an interactive network before relying on this result.",
      );
    } else {
      logger.warn(
        `Qualification never observed version ${expectedVersion}; probes kept reporting a healthy previous version. ` +
          "The rollout may still be propagating, so traffic is left in place and staging is NOT rolled back. " +
          "Recheck the deployed version from an interactive network before relying on this result.",
      );
    }
    return {
      degraded: false,
      exitCode: 0,
      failures: lastFailures,
      propagationDelay: true,
      qualified: false,
      success: true,
    };
  }

  logger.error(`Release qualification failed after ${String(attempts)} attempts:`);
  for (const failure of lastFailures) {
    logger.error(`- ${failure}`);
  }
  return {
    degraded: false,
    exitCode: 1,
    failures: lastFailures,
    propagationDelay: false,
    qualified: false,
    success: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const outcome = await runQualification();
    if (outcome.exitCode !== 0) {
      process.exitCode = outcome.exitCode;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
