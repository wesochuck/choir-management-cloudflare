// Local evidence only: this receipt cannot authorize deployment or production promotion.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, realpath, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { verifyReleaseManifest } from "./release-artifact.mjs";
import { applyReleaseBuildDefaults } from "./release-environment.mjs";
import { writeReceiptAtomic } from "./release-shared.mjs";

export const QUALIFICATION_MAX_AGE_MS = 4 * 60 * 60 * 1000;

const digest = (value) => createHash("sha256").update(value).digest("hex");
const receiptPath = (root) => join(root, ".wrangler/releases/qualification.json");

export async function qualificationInputs(root = process.cwd(), env = process.env) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  if (git("status", "--porcelain", "--untracked-files=all") !== "") {
    throw new Error("the checkout has uncommitted changes");
  }
  const localFiles = [];
  for (const directory of [".", "apps/web", "apps/worker"]) {
    for (const name of (await readdir(resolve(root, directory))).sort()) {
      if (/^(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?|\.npmrc)$/u.test(name)) {
        const path = join(directory, name);
        localFiles.push([path, digest(await readFile(resolve(root, path)))]);
      }
    }
  }
  const installPath = join(root, "node_modules/.package-lock.json");
  const installStat = await stat(installPath);
  const modulesStat = await stat(join(root, "node_modules"));
  const environment = Object.entries(applyReleaseBuildDefaults({ ...env }))
    .filter(([key]) => /^(?:CI|TZ|BUILD_VERSION|NODE_.*|VITE_.*|PLAYWRIGHT_.*)$/u.test(key))
    .sort(([left], [right]) => left.localeCompare(right));
  return {
    checkout: await realpath(root),
    commitSha: git("rev-parse", "HEAD"),
    lockfileSha256: digest(await readFile(join(root, "package-lock.json"))),
    runtime: `${process.version}/${process.platform}/${process.arch}`,
    installationSha256: digest(
      JSON.stringify([
        digest(await readFile(installPath)),
        installStat.ino,
        installStat.mtimeMs,
        installStat.ctimeMs,
        modulesStat.ino,
      ]),
    ),
    localConfigurationSha256: digest(JSON.stringify(localFiles)),
    environmentSha256: digest(JSON.stringify(environment)),
  };
}

export async function invalidateQualification(root = process.cwd()) {
  await rm(receiptPath(root), { force: true });
}

export async function recordQualification({
  root = process.cwd(),
  inputs,
  manifest,
  startedAt,
  now = Date.now(),
}) {
  const current = await qualificationInputs(root);
  if (JSON.stringify(inputs) !== JSON.stringify(current)) {
    throw new Error("Release inputs changed during qualification; rerun check:release.");
  }
  if (!manifest) throw new Error("Release qualification requires artifact evidence.");
  await verifyReleaseManifest(root, current.commitSha, manifest);
  const receipt = {
    schemaVersion: 1,
    gate: "check:release",
    startedAt,
    qualifiedAt: now,
    inputs,
    manifest,
  };
  await writeReceiptAtomic(receiptPath(root), receipt);
  return receipt;
}

export async function readQualification({ root = process.cwd(), now = Date.now() } = {}) {
  let recordLoaded = false;
  try {
    const raw = await readFile(receiptPath(root), "utf8");
    recordLoaded = true;
    const receipt = JSON.parse(raw);
    if (receipt.schemaVersion !== 1 || receipt.gate !== "check:release") {
      throw new Error("unsupported qualification record");
    }
    if (
      !Number.isFinite(receipt.startedAt) ||
      !Number.isFinite(receipt.qualifiedAt) ||
      receipt.startedAt > receipt.qualifiedAt ||
      receipt.qualifiedAt > now
    ) {
      throw new Error("qualification timestamps are invalid or future-dated");
    }
    if (now - receipt.startedAt >= QUALIFICATION_MAX_AGE_MS) {
      throw new Error("qualification expired (four-hour limit from gate start)");
    }
    const current = await qualificationInputs(root);
    if (JSON.stringify(receipt.inputs) !== JSON.stringify(current)) {
      const labels = {
        checkout: "checkout location",
        commitSha: "commit",
        lockfileSha256: "lockfile",
        runtime: "Node runtime/platform",
        installationSha256: "dependency installation",
        localConfigurationSha256: "local configuration",
        environmentSha256: "build/test environment",
      };
      const changed = Object.entries(labels)
        .filter(([key]) => receipt.inputs?.[key] !== current[key])
        .map(([, label]) => label);
      throw new Error(
        changed.length > 0
          ? `release inputs changed: ${changed.join(", ")}`
          : "qualification input format changed",
      );
    }
    // Always rehash the complete file set, detecting additions, removals, and changed bytes.
    if (!receipt.manifest) throw new Error("qualification has no artifact evidence");
    await verifyReleaseManifest(root, current.commitSha, receipt.manifest);
    return { receipt, reason: null };
  } catch (error) {
    return {
      receipt: null,
      reason:
        error?.code === "ENOENT"
          ? recordLoaded
            ? "qualified build files or dependency installation are missing"
            : "qualification record is missing (qualify a clean committed checkout first)"
          : error instanceof SyntaxError
            ? "qualification record is malformed"
            : error.message,
    };
  }
}
