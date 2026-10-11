#!/usr/bin/env node
// Build-once production promotion for issue #134.
//
// Reuses the exact staging-qualified Worker bundle and frontend assets without
// rebuilding or rerunning the full release suite. Refuses missing, incomplete,
// stale, or ambiguous staging qualification.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import {
  activeVersionId as sharedActiveVersionId,
  artifactDirForSha,
  assertPromotableStagingReceipt,
  assertPromoteCheckout,
  assertStagingFreshness,
  createProductionReceipt,
  deployTriggers as sharedDeployTriggers,
  deployVersion as sharedDeployVersion,
  formatPromotionSummary,
  parsePromoteArgs,
  productionReceiptPath,
  run as sharedRun,
  sanitizeExternalOutput as sharedSanitize,
  selectStagingReceipt,
  uploadedVersionId as sharedUploadedVersionId,
  verifyArtifactMatchesReceipt,
  WORKER_CONFIG,
  writeReceiptAtomic,
} from "./release-shared.mjs";

const workerConfig = WORKER_CONFIG;
const productionProductUrl = "https://musicsite.org";
const stagingWorkerUrl =
  "https://choir-management-cloudflare-staging.wes-osborn-account.workers.dev";
const emailSendingDomain = "mail.musicsite.org";
const emailFeedbackQueue = "choir-management-email-events-production";
const expectedEmailEvents = new Set([
  "message.delivered",
  "message.deferred",
  "message.bounced",
  "message.failed",
  "message.rejected",
  "message.complained",
]);

export function assertEmailSendingEnabled(output, domain) {
  const normalizedDomain = domain.trim().toLowerCase();
  const lines = String(output).split(/\r?\n/u);
  const isEnabled = lines.some((line) => {
    const parts = line.split("│").map((part) => part.trim().toLowerCase());
    return parts.length >= 4 && parts[2] === normalizedDomain && parts[3] === "yes";
  });
  if (!isEnabled) {
    throw new Error(
      `Email Sending is not enabled for '${domain}'. Run 'npx wrangler email sending enable ${domain}'.`,
    );
  }
}

export function assertEmailFeedbackSubscription(subscriptions, domain = emailSendingDomain) {
  if (!Array.isArray(subscriptions)) throw new Error("Unexpected queue subscription response.");
  const valid = subscriptions.some(
    (candidate) =>
      candidate?.enabled === true &&
      candidate?.source?.type === "email.sending" &&
      candidate?.source?.domain === domain &&
      candidate?.destination?.type === "queues.queue" &&
      Array.isArray(candidate.events) &&
      candidate.events.length === expectedEmailEvents.size &&
      candidate.events.every((event) => expectedEmailEvents.has(event)),
  );
  if (!valid)
    throw new Error("The production Email Sending subscription is missing or incomplete.");
}

function defaultWrangler(args, options = {}) {
  return sharedRun("npx", ["--no-install", "wrangler", ...args], options);
}

function defaultGetCheckoutState() {
  const branch = sharedRun("git", ["branch", "--show-current"], { capture: true }).trim();
  const status = sharedRun("git", ["status", "--porcelain"], { capture: true }).trim();
  const head = sharedRun("git", ["rev-parse", "HEAD"], { capture: true }).trim();
  return { branch, head, status };
}

function defaultVerifyCommitExists(commitSha) {
  sharedRun("git", ["cat-file", "-e", `${commitSha}^{commit}`], { capture: true });
}

function defaultGetStagingStatus(wranglerRunner = defaultWrangler) {
  return JSON.parse(
    wranglerRunner(
      ["deployments", "status", "--json", "--config", workerConfig, "--env", "staging"],
      { capture: true },
    ),
  );
}

function defaultGetProductionStatus(wranglerRunner = defaultWrangler) {
  return JSON.parse(
    wranglerRunner(
      ["deployments", "status", "--json", "--config", workerConfig, "--env", "production"],
      { capture: true },
    ),
  );
}

async function defaultGetStagingHealthVersion() {
  const response = await fetch(`${stagingWorkerUrl}/api/health`, {
    headers: { accept: "application/json", "cache-control": "no-cache" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(
      `Cannot verify staging freshness: staging health returned HTTP ${String(response.status)}.`,
    );
  }
  const body = await response.json().catch(() => undefined);
  if (typeof body?.version !== "string" || body.version === "") {
    throw new Error("Cannot verify staging freshness: staging health did not report a version.");
  }
  return body.version;
}

async function defaultUploadProductionVersion(artifactDir, commitSha, options = {}) {
  const wranglerRunner = options.wrangler ?? defaultWrangler;
  const scratch = await mkdtemp(join(tmpdir(), "choir-promote-upload-"));
  try {
    const uploadOutputPath = join(scratch, "version-upload.json");
    wranglerRunner(
      [
        "versions",
        "upload",
        join(artifactDir, "apps", "worker", "dist", "index.js"),
        "--no-bundle",
        "--assets",
        join(artifactDir, "apps", "web", "dist"),
        "--config",
        workerConfig,
        "--env",
        "production",
        "--var",
        `BUILD_VERSION:${commitSha}`,
        "--tag",
        `promote-${commitSha.slice(0, 12)}`,
        "--message",
        `Promote staging-qualified ${commitSha}`,
      ],
      { capture: true, env: { WRANGLER_OUTPUT_FILE_PATH: uploadOutputPath } },
    );
    return sharedUploadedVersionId(await readFile(uploadOutputPath, "utf8"));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function defaultQualifyProduction(commitSha, options = {}) {
  const runner = options.runner ?? sharedRun;
  runner("node", ["scripts/qualify-staging.mjs"], {
    env: {
      DEPLOY_EXPECTED_ENVIRONMENT: "production",
      DEPLOY_EXPECTED_VERSION: commitSha,
      DEPLOY_ORG_SLUGS: "",
      DEPLOY_PRODUCT_URL: productionProductUrl,
      STAGING_QUALIFY_ATTEMPTS: "36",
      STAGING_QUALIFY_RETRY_MS: "5000",
    },
  });
}

export async function promoteToProduction(options = {}) {
  const argv = options.argv ?? process.argv;
  const { hasYes, sha: requestedSha } = parsePromoteArgs(argv);
  if (!hasYes) {
    throw new Error(
      "Production promotion requires explicit confirmation: npm run release:promote -- --yes [--sha <commit>]",
    );
  }

  const releasesDir = options.releasesDir;
  const releasesOption = releasesDir ? { releasesDir } : {};
  const wranglerRunner = options.wrangler ?? defaultWrangler;
  const commandRunner = options.runner ?? sharedRun;

  console.log("Selecting the staging-qualified release...");
  const selectFn = options.selectReceipt ?? selectStagingReceipt;
  const { receipt, path: receiptPath } = await selectFn({
    ...releasesOption,
    sha: requestedSha ?? options.sha ?? null,
  });
  assertPromotableStagingReceipt(receipt);
  const commitSha = receipt.commitSha;

  console.log("Verifying local source integrity (never substituting origin/main)...");
  const getCheckoutState = options.getCheckoutState ?? defaultGetCheckoutState;
  const checkoutState = getCheckoutState();
  assertPromoteCheckout(checkoutState);
  const verifyCommit = options.verifyCommitExists ?? defaultVerifyCommitExists;
  try {
    await verifyCommit(commitSha);
  } catch {
    throw new Error(
      `The qualified commit ${commitSha} is not available locally. Fetch the release source before promoting.`,
    );
  }
  if (checkoutState.head && checkoutState.head !== commitSha) {
    console.warn(
      `Local HEAD ${checkoutState.head} differs from the qualified commit ${commitSha}; promoting the qualified artifact, not HEAD.`,
    );
  }

  const artifactDir =
    options.artifactDir ?? receipt.artifactDir ?? artifactDirForSha(commitSha, releasesOption);
  console.log(`Verifying the retained staging artifact at ${artifactDir}...`);
  const verifyArtifact = options.verifyArtifact ?? verifyArtifactMatchesReceipt;
  await verifyArtifact(artifactDir, receipt);

  console.log("Verifying staging still serves the qualified version...");
  const getStagingStatus =
    options.getStagingStatus ?? ((runner) => defaultGetStagingStatus(runner ?? wranglerRunner));
  const stagingStatus = await getStagingStatus(wranglerRunner);
  const getHealthVersion = options.getStagingHealthVersion ?? defaultGetStagingHealthVersion;
  let healthVersion;
  try {
    healthVersion = await getHealthVersion(commitSha);
  } catch (error) {
    // A health-probe failure must not silently authorize production. Surface it
    // as a freshness failure with an actionable reason.
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Staging freshness check failed: ${detail}`, { cause: error });
  }
  try {
    assertStagingFreshness({ healthVersion, receipt, stagingStatus });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(detail, { cause: error });
  }

  console.log(formatPromotionSummary({ artifactDir, receipt }));
  console.log(`Staging receipt: ${receiptPath}`);

  console.log("Running production preflights...");
  wranglerRunner(["whoami"], { capture: true });
  const emailSendingList = wranglerRunner(["email", "sending", "list"], { capture: true });
  assertEmailSendingEnabled(emailSendingList, emailSendingDomain);
  const subscriptions = JSON.parse(
    wranglerRunner(["queues", "subscription", "list", emailFeedbackQueue, "--json"], {
      capture: true,
    }),
  );
  assertEmailFeedbackSubscription(subscriptions, emailSendingDomain);
  const getProductionStatus =
    options.getProductionStatus ??
    ((runner) => defaultGetProductionStatus(runner ?? wranglerRunner));
  const previousVersionId = sharedActiveVersionId(
    await getProductionStatus(wranglerRunner),
    "production",
  );

  let uploadedId;
  let trafficShifted = false;
  try {
    console.log("Applying forward-only production migrations and version-external triggers...");
    wranglerRunner([
      "d1",
      "migrations",
      "apply",
      "CONTROL_DB",
      "--config",
      workerConfig,
      "--env",
      "production",
      "--remote",
    ]);
    const deployTriggersRunner =
      options.deployTriggers ?? ((env, opts) => sharedDeployTriggers(env, opts));
    await deployTriggersRunner("production", {
      runner: options.deployTriggersRunner ?? wranglerRunner,
    });

    console.log("Uploading the exact staging-qualified bytes to production...");
    const uploadFn = options.uploadVersion ?? defaultUploadProductionVersion;
    uploadedId = await uploadFn(artifactDir, commitSha, { wrangler: wranglerRunner });

    console.log(`Promoting Worker version ${uploadedId} to 100% of production traffic...`);
    const deployVersionRunner =
      options.deployVersion ??
      ((versionId, message, opts) =>
        sharedDeployVersion(versionId, message, { env: "production", ...opts }));
    const deployVersionWrangler = options.deployVersionRunner ?? wranglerRunner;
    await deployVersionRunner(uploadedId, `Promote staging-qualified ${commitSha}`, {
      runner: deployVersionWrangler,
    });
    trafficShifted = true;

    console.log("Qualifying the exact promoted production build...");
    const qualifyFn = options.qualifyProduction ?? defaultQualifyProduction;
    await qualifyFn(commitSha, { runner: commandRunner, wrangler: wranglerRunner });

    const finalStatus = await getProductionStatus(wranglerRunner);
    if (sharedActiveVersionId(finalStatus, "production") !== uploadedId) {
      throw new Error("The uploaded Worker version does not serve 100% of production traffic.");
    }
    const deploymentId =
      typeof finalStatus.id === "string" ? finalStatus.id : finalStatus.deployment_id;

    const record = createProductionReceipt({
      artifactDir,
      artifactManifestSha256: receipt.artifactManifestSha256,
      buildVersion: commitSha,
      commitSha,
      deploymentId: typeof deploymentId === "string" ? deploymentId : null,
      lockfileSha256: receipt.lockfileSha256,
      previousWorkerVersionId: previousVersionId,
      qualifiedAt: new Date().toISOString(),
      sourceStagingQualifiedAt: receipt.qualifiedAt,
      sourceStagingReceipt: receiptPath,
      sourceStagingWorkerVersionId: receipt.workerVersionId,
      workerVersionId: uploadedId,
    });
    const writeReceipt = options.writeReceipt ?? writeReceiptAtomic;
    await writeReceipt(productionReceiptPath(commitSha, releasesOption), record);

    console.log(`Production promotion complete: ${commitSha} → ${uploadedId}.`);
    console.log(
      "Reused the staging-qualified artifact with no rebuild and no full CI/E2E rerun. " +
        "Rollback restores prior production Worker code only; D1 migrations, triggers, routes, and external settings require manual recovery (see docs/runbooks/rollback.md).",
    );
    return { commitSha, productionReceipt: record, uploadedId };
  } catch (error) {
    if (trafficShifted && previousVersionId) {
      console.error(
        "Production qualification failed; restoring the captured previous Worker version...",
      );
      try {
        const deployVersionRunner =
          options.deployVersion ??
          ((versionId, message, opts) =>
            sharedDeployVersion(versionId, message, { env: "production", ...opts }));
        const deployVersionWrangler = options.deployVersionRunner ?? wranglerRunner;
        await deployVersionRunner(previousVersionId, `Automatic rollback from ${commitSha}`, {
          runner: deployVersionWrangler,
        });
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Release failed and automatic rollback failed.",
          { cause: rollbackError },
        );
      }
    }
    throw error;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  promoteToProduction().catch((error) => {
    console.error(sharedSanitize(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
