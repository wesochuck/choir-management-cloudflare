#!/usr/bin/env node
// Shared build-once release helpers for issue #134.
//
// Staging builds and qualifies once, then production promotion reuses the exact
// verified bytes. This module centralizes manifest verification, persistent
// artifact paths, per-environment receipts, Worker version helpers, and retry
// semantics so staging and promotion cannot subtly diverge.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { verifyReleaseManifest } from "./release-artifact.mjs";

export const WORKER_CONFIG = "apps/worker/wrangler.jsonc";
export const RELEASES_DIRNAME = join(".wrangler", "releases");
export const ARTIFACTS_DIRNAME = "artifacts";
export const STAGING_RECEIPT_PREFIX = "staging-";
export const PRODUCTION_RECEIPT_PREFIX = "production-";

const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/u;

export function sanitizeExternalOutput(value) {
  return String(value)
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, "[redacted-email]")
    .replace(/(bearer|token|secret)(\s*[:=]\s*)\S+/giu, "$1$2[redacted]");
}

export function assertCommitSha(commitSha) {
  if (!COMMIT_SHA_PATTERN.test(commitSha)) {
    throw new Error("Release commit SHA must be a lowercase, full-length Git commit SHA.");
  }
}

export function releasesDir(options = {}) {
  return options.releasesDir ?? resolve(RELEASES_DIRNAME);
}

export function artifactDirForSha(commitSha, options = {}) {
  assertCommitSha(commitSha);
  return join(releasesDir(options), ARTIFACTS_DIRNAME, commitSha);
}

export function stagingReceiptPath(commitSha, options = {}) {
  assertCommitSha(commitSha);
  return join(releasesDir(options), `${STAGING_RECEIPT_PREFIX}${commitSha}.json`);
}

export function productionReceiptPath(commitSha, options = {}) {
  assertCommitSha(commitSha);
  return join(releasesDir(options), `${PRODUCTION_RECEIPT_PREFIX}${commitSha}.json`);
}

export function legacyReceiptPath(commitSha, options = {}) {
  assertCommitSha(commitSha);
  return join(releasesDir(options), `${commitSha}.json`);
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = options.capture
      ? sanitizeExternalOutput(`${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim())
      : "See the command output above.";
    throw new Error(`${command} ${args.join(" ")} failed. ${output}`);
  }
  return options.capture ? String(result.stdout ?? "") : "";
}

export function assertReleaseCheckout(state, environment) {
  const label = environment === "production" ? "Production" : "Staging";
  if (state.branch !== "main") {
    throw new Error(`${label} releases must run from the main branch.`);
  }
  if (state.status !== "") {
    throw new Error(`${label} releases require a clean working tree.`);
  }
  if (state.head !== state.originMain) {
    throw new Error(`Local main must exactly match origin/main before ${environment} deployment.`);
  }
  assertCommitSha(state.head);
}

export function assertPromoteCheckout({ branch, status }) {
  if (branch !== "main") {
    throw new Error("Production promotion must run from the main branch.");
  }
  if (status !== "") {
    throw new Error("Production promotion requires a clean working tree.");
  }
}

export function activeVersionId(status, environment = "staging") {
  const version = status?.versions?.find((candidate) => candidate.percentage === 100);
  if (typeof version?.version_id !== "string" || version.version_id === "") {
    throw new Error(`No Worker version currently serves 100% of ${environment} traffic.`);
  }
  return version.version_id;
}

export function uploadedVersionId(output) {
  const records = String(output)
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  const result = records.find(
    (record) => record && typeof record === "object" && typeof record.version_id === "string",
  );
  if (!result) throw new Error("Wrangler did not report an uploaded Worker version ID.");
  return result.version_id;
}

function defaultWrangler(args, options = {}) {
  return run("npx", ["--no-install", "wrangler", ...args], options);
}

export async function deployVersion(versionId, message, options = {}) {
  const env = options.env ?? "staging";
  const attempts = options.attempts ?? 6;
  const retryDelayMs = options.retryDelayMs ?? 2000;
  const runner = options.runner ?? defaultWrangler;
  const sleeper = options.sleeper ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const output = runner(
        [
          "versions",
          "deploy",
          `${versionId}@100%`,
          "--yes",
          "--config",
          options.workerConfig ?? WORKER_CONFIG,
          "--env",
          env,
          "--message",
          message,
        ],
        { capture: true },
      );
      if (output && typeof output === "string" && output.trim().length > 0) {
        console.log(output.trim());
      }
      return;
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      const isVersionNotFound =
        messageText.includes("100146") || messageText.includes("could not be found");
      if (isVersionNotFound && attempt < attempts) {
        console.warn(
          `Worker version ${versionId} is not yet visible on Cloudflare (attempt ${attempt}/${attempts}); retrying in ${retryDelayMs}ms...`,
        );
        await sleeper(retryDelayMs);
        continue;
      }
      throw error;
    }
  }
}

export async function deployTriggers(envName, options = {}) {
  const attempts = options.attempts ?? 4;
  const retryDelayMs = options.retryDelayMs ?? 2000;
  const runner = options.runner ?? defaultWrangler;
  const sleeper = options.sleeper ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const output = runner(
        ["triggers", "deploy", "--config", options.workerConfig ?? WORKER_CONFIG, "--env", envName],
        { capture: true },
      );
      if (output && typeof output === "string" && output.trim().length > 0) {
        console.log(output.trim());
      }
      return;
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      const isRetriableTriggerError =
        messageText.includes("10013") ||
        messageText.includes("only partially updated") ||
        messageText.includes("rate limit") ||
        messageText.includes("429");
      if (isRetriableTriggerError && attempt < attempts) {
        console.warn(
          `Trigger deployment for '${envName}' encountered transient Cloudflare error (attempt ${attempt}/${attempts}); retrying in ${retryDelayMs}ms...`,
        );
        await sleeper(retryDelayMs);
        continue;
      }
      throw error;
    }
  }
}

export async function sha256File(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

export async function readManifestHashes(artifactDir) {
  const manifestPath = join(artifactDir, "release-manifest.json");
  const bytes = await readFile(manifestPath, "utf8").catch(() => {
    throw new Error(`The release artifact is unavailable: missing ${manifestPath}.`);
  });
  let manifest;
  try {
    manifest = JSON.parse(bytes);
  } catch {
    throw new Error("The release artifact is corrupted: manifest is not valid JSON.");
  }
  const manifestSha256 = createHash("sha256").update(bytes).digest("hex");
  const lockfileSha256 = manifest?.lockfile?.sha256;
  if (typeof lockfileSha256 !== "string" || lockfileSha256 === "") {
    throw new Error("The release artifact is incomplete: missing lockfile hash.");
  }
  return { lockfileSha256, manifest, manifestSha256 };
}

export async function verifyPersistedArtifact(artifactDir, expectedSha) {
  assertCommitSha(expectedSha);
  return verifyReleaseManifest(artifactDir, expectedSha);
}

export async function writeReceiptAtomic(targetPath, record) {
  const directory = resolve(targetPath, "..");
  await mkdir(directory, { recursive: true });
  const tmpPath = `${targetPath}.tmp.${String(process.pid)}.${String(Date.now())}`;
  await writeFile(tmpPath, `${JSON.stringify(record, undefined, 2)}\n`, "utf8");
  await rename(tmpPath, targetPath);
}

export function createStagingReceipt({
  artifactManifestSha256,
  artifactDir,
  buildVersion,
  commitSha,
  deploymentId,
  lockfileSha256,
  previousWorkerVersionId,
  qualification = "pass",
  qualifiedAt,
  releaseGate = "check:release",
  workerVersionId,
}) {
  assertCommitSha(commitSha);
  if (!artifactManifestSha256 || !lockfileSha256 || !workerVersionId) {
    throw new Error("Cannot create a staging receipt without artifact and version evidence.");
  }
  return {
    artifactDir,
    artifactManifestSha256,
    buildVersion: buildVersion ?? commitSha,
    commitSha,
    deploymentId: deploymentId ?? null,
    environment: "staging",
    lockfileSha256,
    previousWorkerVersionId: previousWorkerVersionId ?? null,
    qualification,
    qualifiedAt,
    releaseGate,
    schemaVersion: 2,
    workerVersionId,
  };
}

export function createProductionReceipt({
  artifactDir,
  artifactManifestSha256,
  buildVersion,
  commitSha,
  deploymentId,
  lockfileSha256,
  previousWorkerVersionId,
  qualifiedAt,
  sourceStagingQualifiedAt,
  sourceStagingReceipt,
  sourceStagingWorkerVersionId,
  workerVersionId,
}) {
  assertCommitSha(commitSha);
  if (!artifactManifestSha256 || !lockfileSha256 || !workerVersionId) {
    throw new Error("Cannot create a production receipt without artifact and version evidence.");
  }
  return {
    artifactDir,
    artifactManifestSha256,
    buildVersion: buildVersion ?? commitSha,
    commitSha,
    deploymentId: deploymentId ?? null,
    environment: "production",
    lockfileSha256,
    previousWorkerVersionId: previousWorkerVersionId ?? null,
    qualification: "pass",
    qualifiedAt,
    schemaVersion: 2,
    sourceStagingQualifiedAt: sourceStagingQualifiedAt ?? null,
    sourceStagingReceipt: sourceStagingReceipt ?? null,
    sourceStagingWorkerVersionId: sourceStagingWorkerVersionId ?? null,
    workerVersionId,
  };
}

export function assertPromotableStagingReceipt(receipt) {
  if (!receipt || typeof receipt !== "object") {
    throw new Error("Staging qualification is missing: no receipt was found.");
  }
  if (receipt.environment !== "staging") {
    throw new Error("Staging qualification is missing: receipt is for the wrong environment.");
  }
  if (receipt.schemaVersion !== 2) {
    throw new Error(
      "Staging qualification is incomplete: legacy receipt lacks artifact hashes. Re-run staging qualification with the current release tooling.",
    );
  }
  if (receipt.qualification !== "pass") {
    throw new Error("Staging qualification is missing: receipt does not report a passing run.");
  }
  for (const field of [
    "commitSha",
    "lockfileSha256",
    "artifactManifestSha256",
    "workerVersionId",
    "qualifiedAt",
    "buildVersion",
  ]) {
    if (typeof receipt[field] !== "string" || receipt[field] === "") {
      throw new Error(
        `Staging qualification is incomplete: receipt is missing '${field}'. Re-run staging qualification.`,
      );
    }
  }
  assertCommitSha(receipt.commitSha);
  if (receipt.buildVersion !== receipt.commitSha) {
    throw new Error(
      "Staging qualification is incomplete: BUILD_VERSION does not match the qualified commit.",
    );
  }
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function readStagingReceipt(commitSha, options = {}) {
  assertCommitSha(commitSha);
  const primary = await readJsonIfExists(stagingReceiptPath(commitSha, options));
  if (primary) return primary;
  const legacy = await readJsonIfExists(legacyReceiptPath(commitSha, options));
  if (legacy && legacy.environment === "staging") return legacy;
  return null;
}

export async function listStagingReceipts(options = {}) {
  const dir = releasesDir(options);
  let entries;
  try {
    entries = await readdir(dir);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const receipts = [];
  const seen = new Set();
  for (const entry of entries.sort()) {
    let sha;
    if (entry.startsWith(STAGING_RECEIPT_PREFIX) && entry.endsWith(".json")) {
      sha = entry.slice(STAGING_RECEIPT_PREFIX.length, -".json".length);
    } else if (/^[0-9a-f]{40}\.json$/u.test(entry)) {
      sha = entry.slice(0, -".json".length);
    } else {
      continue;
    }
    if (!COMMIT_SHA_PATTERN.test(sha) || seen.has(sha)) continue;
    seen.add(sha);
    // Prefer the namespaced receipt; fall back to the legacy file for the same SHA.
    const namespaced = await readJsonIfExists(join(dir, `${STAGING_RECEIPT_PREFIX}${sha}.json`));
    if (namespaced && namespaced.environment === "staging") {
      receipts.push({
        path: join(dir, `${STAGING_RECEIPT_PREFIX}${sha}.json`),
        receipt: namespaced,
      });
      continue;
    }
    // A production-namespaced receipt for this SHA must not satisfy a staging lookup.
    const legacy = await readJsonIfExists(join(dir, `${sha}.json`));
    if (legacy && legacy.environment === "staging") {
      receipts.push({ path: join(dir, `${sha}.json`), receipt: legacy });
    }
  }
  return receipts;
}

export async function selectStagingReceipt(options = {}) {
  const requestedSha = options.sha ?? null;
  if (requestedSha) {
    assertCommitSha(requestedSha);
    const receipt = await readStagingReceipt(requestedSha, options);
    if (!receipt) {
      throw new Error(
        `Staging qualification is missing for ${requestedSha}: no successful staging receipt was found.`,
      );
    }
    return {
      path: (await readJsonIfExists(stagingReceiptPath(requestedSha, options)))
        ? stagingReceiptPath(requestedSha, options)
        : legacyReceiptPath(requestedSha, options),
      receipt,
    };
  }
  const all = await listStagingReceipts(options);
  if (all.length === 0) {
    throw new Error(
      "Staging qualification is missing: no successful staging receipt was found. Run the staging release first.",
    );
  }
  if (all.length > 1) {
    const shas = all
      .map((entry) => entry.receipt.commitSha)
      .sort()
      .join(", ");
    throw new Error(
      `Multiple qualified staging releases exist (${shas}); specify --sha <commit> to select one explicitly.`,
    );
  }
  return all[0];
}

export function assertStagingFreshness({ receipt, stagingStatus, healthVersion = null }) {
  const activeId = activeVersionId(stagingStatus, "staging");
  if (activeId !== receipt.workerVersionId) {
    throw new Error(
      `Staging now serves a different Worker version (active ${activeId}) than the qualified version ${receipt.workerVersionId}. Re-qualify staging before promoting.`,
    );
  }
  if (healthVersion !== null && healthVersion !== receipt.commitSha) {
    throw new Error(
      `Staging now serves a different SHA/version (${String(healthVersion)}) than the qualified commit ${receipt.commitSha}. Re-qualify staging before promoting.`,
    );
  }
}

export async function verifyArtifactMatchesReceipt(artifactDir, receipt) {
  assertPromotableStagingReceipt(receipt);
  let manifest;
  try {
    manifest = await verifyPersistedArtifact(artifactDir, receipt.commitSha);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`The release artifact changed since qualification or is corrupted: ${detail}`, {
      cause: error,
    });
  }
  const { lockfileSha256, manifestSha256 } = await readManifestHashes(artifactDir);
  if (lockfileSha256 !== receipt.lockfileSha256) {
    throw new Error(
      "The release artifact changed since qualification: lockfile hash mismatch. Re-run staging qualification.",
    );
  }
  if (manifestSha256 !== receipt.artifactManifestSha256) {
    throw new Error(
      "The release artifact changed since qualification: manifest hash mismatch. Re-run staging qualification.",
    );
  }
  return manifest;
}

export async function persistStagingArtifact(tempRoot, commitSha, options = {}) {
  assertCommitSha(commitSha);
  const target = artifactDirForSha(commitSha, options);
  const tmpTarget = `${target}.tmp.${String(process.pid)}.${String(Date.now())}`;
  await rm(tmpTarget, { recursive: true, force: true });
  await mkdir(tmpTarget, { recursive: true });
  await mkdir(join(tmpTarget, "apps", "worker"), { recursive: true });
  await mkdir(join(tmpTarget, "apps", "web"), { recursive: true });
  await cp(join(tempRoot, "package-lock.json"), join(tmpTarget, "package-lock.json"));
  await cp(join(tempRoot, "apps", "worker", "dist"), join(tmpTarget, "apps", "worker", "dist"), {
    recursive: true,
  });
  await cp(join(tempRoot, "apps", "web", "dist"), join(tmpTarget, "apps", "web", "dist"), {
    recursive: true,
  });
  await cp(join(tempRoot, "release-manifest.json"), join(tmpTarget, "release-manifest.json"));
  await verifyPersistedArtifact(tmpTarget, commitSha);
  // Only a successful staging qualification reaches this point, so replacing a
  // prior persistent artifact for the same SHA is a newly qualified update, not
  // a misleading overwrite. Failed runs never touch the persistent directory.
  await rm(target, { recursive: true, force: true });
  await mkdir(join(target, ".."), { recursive: true });
  await rename(tmpTarget, target);
  return target;
}

export function parsePromoteArgs(argv = process.argv) {
  const hasYes = argv.includes("--yes");
  const shaIndex = argv.indexOf("--sha");
  const sha = shaIndex >= 0 ? argv[shaIndex + 1] : null;
  if (shaIndex >= 0 && (!sha || sha.startsWith("--"))) {
    throw new Error("Production promotion requires a value: --sha <full-commit-sha>.");
  }
  if (sha) assertCommitSha(sha);
  return { hasYes, sha };
}

export function formatPromotionSummary({ receipt, artifactDir, productionEnv = "production" }) {
  return [
    `Production target: ${productionEnv}`,
    `Source commit: ${receipt.commitSha}`,
    `Artifact: ${artifactDir}`,
    `Artifact manifest hash: ${receipt.artifactManifestSha256}`,
    `Lockfile hash: ${receipt.lockfileSha256}`,
    `Staging worker version: ${receipt.workerVersionId}`,
    `Staging qualified at: ${receipt.qualifiedAt}`,
    "Rollback restores the prior production Worker code only; D1 migrations, triggers, routes, and external settings are not automatically reverted.",
  ].join("\n");
}
