#!/usr/bin/env node

import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createReleaseManifest, verifyReleaseManifest } from "./release-artifact.mjs";
import {
  activeVersionId as sharedActiveVersionId,
  assertReleaseCheckout as sharedAssertReleaseCheckout,
  createProductionReceipt,
  deployTriggers as sharedDeployTriggers,
  deployVersion as sharedDeployVersion,
  productionReceiptPath,
  readManifestHashes,
  run as sharedRun,
  sanitizeExternalOutput as sharedSanitize,
  uploadedVersionId as sharedUploadedVersionId,
  verifyPersistedArtifact,
  WORKER_CONFIG,
  writeReceiptAtomic,
} from "./release-shared.mjs";

const workerConfig = WORKER_CONFIG;
const productionProductUrl = "https://musicsite.org";
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

export const sanitizeExternalOutput = sharedSanitize;
export const uploadedVersionId = sharedUploadedVersionId;

function run(command, args, options = {}) {
  return sharedRun(command, args, options);
}

function git(...args) {
  return run("git", args, { capture: true }).trim();
}

export function assertReleaseCheckout(state) {
  return sharedAssertReleaseCheckout(state, "production");
}

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

export function activeVersionId(status) {
  return sharedActiveVersionId(status, "production");
}

function wrangler(args, options = {}) {
  return run("npx", ["--no-install", "wrangler", ...args], options);
}

async function prepareArtifact(releaseRoot, commitSha) {
  await mkdir(join(releaseRoot, "apps", "worker"), { recursive: true });
  await mkdir(join(releaseRoot, "apps", "web"), { recursive: true });
  await cp("package-lock.json", join(releaseRoot, "package-lock.json"));
  await cp("apps/worker/dist", join(releaseRoot, "apps", "worker", "dist"), {
    recursive: true,
  });
  await cp("apps/web/dist", join(releaseRoot, "apps", "web", "dist"), { recursive: true });
  await createReleaseManifest(releaseRoot, commitSha);
  await verifyReleaseManifest(releaseRoot, commitSha);
}

function productionStatus() {
  return JSON.parse(
    wrangler(["deployments", "status", "--json", "--config", workerConfig, "--env", "production"], {
      capture: true,
    }),
  );
}

export async function deployVersion(versionId, message, options = {}) {
  return sharedDeployVersion(versionId, message, { env: "production", ...options });
}

export async function deployTriggers(envName, options = {}) {
  return sharedDeployTriggers(envName, options);
}

async function recordProductionProvenance({
  artifactDir,
  commitSha,
  deploymentId,
  previousWorkerVersionId,
  releasesDir,
  uploadedId,
}) {
  const artifactOptions = releasesDir ? { releasesDir } : {};
  // The legacy independent production path rebuilds its own artifact in a temp
  // directory. Record its hashes in a production-namespaced receipt so it can
  // never overwrite a staging receipt for the same SHA.
  const { lockfileSha256, manifestSha256 } = await readManifestHashes(artifactDir);
  await verifyPersistedArtifact(artifactDir, commitSha);
  const record = createProductionReceipt({
    artifactDir,
    artifactManifestSha256: manifestSha256,
    buildVersion: commitSha,
    commitSha,
    deploymentId: typeof deploymentId === "string" ? deploymentId : null,
    lockfileSha256,
    previousWorkerVersionId,
    qualifiedAt: new Date().toISOString(),
    sourceStagingQualifiedAt: null,
    sourceStagingReceipt: null,
    sourceStagingWorkerVersionId: null,
    workerVersionId: uploadedId,
  });
  await writeReceiptAtomic(productionReceiptPath(commitSha, artifactOptions), record);
  return { record };
}

export async function deployProduction(options = {}) {
  const argv = options.argv ?? process.argv;
  if (!argv.includes("--yes")) {
    throw new Error(
      "Production deployment requires explicit confirmation: npm run deploy:production -- --yes",
    );
  }

  // Issue 277: Enable practice loudness normalization in production builds now that iOS qualification passed.
  process.env.VITE_PRACTICE_LOUDNESS_ENABLED ??=
    options.env?.VITE_PRACTICE_LOUDNESS_ENABLED ?? "true";

  console.log("Verifying clean, current main checkout...");
  const checkoutVerifier = options.verifyCheckout ?? verifyCheckout;
  const commitSha = checkoutVerifier();

  console.log("Running the complete local release gate...");
  const commandRunner = options.runner ?? run;
  commandRunner("npm", ["run", "check:ci"]);
  commandRunner("npx", ["playwright", "install", "chromium"]);
  commandRunner("npm", ["run", "test:e2e"]);
  if (checkoutVerifier() !== commitSha)
    throw new Error("The release commit changed during checks.");

  const releaseRoot = await mkdtemp(join(tmpdir(), "choir-production-release-"));
  let previousVersionId;
  let uploadedId;
  let trafficShifted = false;
  try {
    console.log("Creating and verifying the immutable local release artifact...");
    const prepare = options.prepareArtifact ?? prepareArtifact;
    await prepare(releaseRoot, commitSha);

    const wranglerRunner = options.wrangler ?? wrangler;
    const statusRunner = options.productionStatus ?? productionStatus;
    const deployVersionRunner = options.deployVersion ?? deployVersion;
    const deployTriggersRunner = options.deployTriggers ?? deployTriggers;
    const recordRunner = options.recordProvenance ?? recordProductionProvenance;

    wranglerRunner(["whoami"], { capture: true });
    const emailSendingList = wranglerRunner(["email", "sending", "list"], { capture: true });
    assertEmailSendingEnabled(emailSendingList, emailSendingDomain);

    const subscriptions = JSON.parse(
      wranglerRunner(["queues", "subscription", "list", emailFeedbackQueue, "--json"], {
        capture: true,
      }),
    );
    assertEmailFeedbackSubscription(subscriptions, emailSendingDomain);
    previousVersionId = activeVersionId(statusRunner());

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
    await deployTriggersRunner("production");

    console.log("Uploading the verified artifact as an inactive Worker version...");
    const uploadOutputPath = join(releaseRoot, "version-upload.json");
    wranglerRunner(
      [
        "versions",
        "upload",
        join(releaseRoot, "apps", "worker", "dist", "index.js"),
        "--no-bundle",
        "--assets",
        join(releaseRoot, "apps", "web", "dist"),
        "--config",
        workerConfig,
        "--env",
        "production",
        "--var",
        `BUILD_VERSION:${commitSha}`,
        "--tag",
        `local-${commitSha.slice(0, 12)}`,
        "--message",
        `Local production release ${commitSha}`,
      ],
      { capture: true, env: { WRANGLER_OUTPUT_FILE_PATH: uploadOutputPath } },
    );
    uploadedId = uploadedVersionId(await readFile(uploadOutputPath, "utf8"));

    console.log(`Promoting Worker version ${uploadedId} to 100% of production traffic...`);
    await deployVersionRunner(uploadedId, `Production release ${commitSha}`);
    trafficShifted = true;

    console.log("Qualifying the exact deployed production build...");
    commandRunner("node", ["scripts/qualify-staging.mjs"], {
      env: {
        DEPLOY_EXPECTED_ENVIRONMENT: "production",
        DEPLOY_EXPECTED_VERSION: commitSha,
        DEPLOY_ORG_SLUGS: "",
        DEPLOY_PRODUCT_URL: productionProductUrl,
        STAGING_QUALIFY_ATTEMPTS: "36",
        STAGING_QUALIFY_RETRY_MS: "5000",
      },
    });

    const finalStatus = statusRunner();
    if (activeVersionId(finalStatus) !== uploadedId) {
      throw new Error("The uploaded Worker version does not serve 100% of production traffic.");
    }
    const deploymentId =
      typeof finalStatus.id === "string" ? finalStatus.id : finalStatus.deployment_id;
    await recordRunner({
      artifactDir: releaseRoot,
      commitSha,
      deploymentId,
      previousWorkerVersionId: previousVersionId,
      releasesDir: options.releasesDir,
      uploadedId,
    });
    console.log(`Production release complete: ${commitSha} → ${uploadedId}.`);
    console.log(
      "Prefer 'npm run release:promote' for build-once promotion of a staging-qualified artifact without rebuilding.",
    );
  } catch (error) {
    if (trafficShifted && previousVersionId) {
      console.error(
        "Production qualification failed; restoring the captured previous Worker version...",
      );
      try {
        const deployVersionRunner = options.deployVersion ?? deployVersion;
        await deployVersionRunner(previousVersionId, `Automatic local rollback from ${commitSha}`);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Release failed and automatic rollback failed.",
          { cause: rollbackError },
        );
      }
    }
    throw error;
  } finally {
    await rm(releaseRoot, { recursive: true, force: true });
  }
}

function verifyCheckout() {
  run("git", ["fetch", "origin", "main", "--quiet"]);
  const state = {
    branch: git("branch", "--show-current"),
    status: git("status", "--porcelain"),
    head: git("rev-parse", "HEAD"),
    originMain: git("rev-parse", "origin/main"),
  };
  assertReleaseCheckout(state);
  return state.head;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  deployProduction().catch((error) => {
    console.error(sharedSanitize(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
