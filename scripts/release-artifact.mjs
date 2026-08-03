import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const manifestName = "release-manifest.json";
const lockfilePath = "package-lock.json";
const releaseDirectories = ["apps/worker/dist", "apps/web/dist"];

function normalizedPath(path) {
  return path.split(sep).join("/");
}

async function sha256(path) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function releaseFiles(root, directory) {
  const absoluteDirectory = resolve(root, directory);
  const files = [];

  async function visit(currentDirectory) {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = resolve(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(
          `Release artifacts may contain only files and directories: ${absolutePath}`,
        );
      }

      const metadata = await stat(absolutePath);
      files.push({
        path: normalizedPath(relative(root, absolutePath)),
        sha256: await sha256(absolutePath),
        size: metadata.size,
      });
    }
  }

  await visit(absoluteDirectory);
  return files;
}

function assertCommitSha(commitSha) {
  if (!/^[0-9a-f]{40}$/u.test(commitSha)) {
    throw new Error("Release commit SHA must be a lowercase, full-length Git commit SHA.");
  }
}

export async function createReleaseManifest(root, commitSha) {
  assertCommitSha(commitSha);
  const lockfile = resolve(root, lockfilePath);
  const manifest = {
    schemaVersion: 1,
    commitSha,
    lockfile: {
      path: lockfilePath,
      sha256: await sha256(lockfile),
    },
    artifacts: {},
  };

  for (const directory of releaseDirectories) {
    const files = await releaseFiles(root, directory);
    if (files.length === 0) throw new Error(`Release directory is empty: ${directory}`);
    manifest.artifacts[directory] = files;
  }

  await writeFile(
    resolve(root, manifestName),
    `${JSON.stringify(manifest, undefined, 2)}\n`,
    "utf8",
  );
  return manifest;
}

function sameFiles(expected, actual) {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

export async function verifyReleaseManifest(root, expectedCommitSha) {
  assertCommitSha(expectedCommitSha);
  const manifest = JSON.parse(await readFile(resolve(root, manifestName), "utf8"));

  if (manifest.schemaVersion !== 1) throw new Error("Unsupported release manifest schema.");
  if (manifest.commitSha !== expectedCommitSha) {
    throw new Error(
      `Release commit mismatch: expected ${expectedCommitSha}, received ${String(manifest.commitSha)}.`,
    );
  }
  if (manifest.lockfile?.path !== lockfilePath) throw new Error("Unexpected lockfile path.");

  const currentLockfileHash = await sha256(resolve(root, lockfilePath));
  if (manifest.lockfile.sha256 !== currentLockfileHash) {
    throw new Error("The lockfile does not match the CI-built release.");
  }

  const artifactKeys = Object.keys(manifest.artifacts ?? {}).sort();
  if (!sameFiles(artifactKeys, [...releaseDirectories].sort())) {
    throw new Error("Release manifest contains an unexpected artifact directory set.");
  }

  for (const directory of releaseDirectories) {
    const expectedFiles = manifest.artifacts[directory];
    const actualFiles = await releaseFiles(root, directory);
    if (!Array.isArray(expectedFiles) || !sameFiles(expectedFiles, actualFiles)) {
      throw new Error(`Release artifact verification failed for ${directory}.`);
    }
  }

  return manifest;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const command = process.argv[2];
  const commitSha = argument("--sha");
  if (!commitSha || (command !== "create" && command !== "verify")) {
    throw new Error("Usage: node scripts/release-artifact.mjs <create|verify> --sha <full-sha>");
  }

  if (command === "create") {
    const manifest = await createReleaseManifest(process.cwd(), commitSha);
    console.log(
      `Created ${manifestName} for ${manifest.commitSha} with ${String(
        Object.values(manifest.artifacts).flat().length,
      )} files.`,
    );
    return;
  }

  await verifyReleaseManifest(process.cwd(), commitSha);
  console.log(`Verified ${manifestName} for ${commitSha}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
