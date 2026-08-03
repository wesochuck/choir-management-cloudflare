import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createReleaseManifest, verifyReleaseManifest } from "./release-artifact.mjs";

const commitSha = "0123456789abcdef0123456789abcdef01234567";
const temporaryRoots = [];

async function releaseRoot() {
  const root = await mkdtemp(join(tmpdir(), "release-artifact-"));
  temporaryRoots.push(root);
  await mkdir(join(root, "apps/worker/dist"), { recursive: true });
  await mkdir(join(root, "apps/web/dist/assets"), { recursive: true });
  await writeFile(join(root, "package-lock.json"), '{"lockfileVersion":3}\n');
  await writeFile(join(root, "apps/worker/dist/index.js"), "export default {};\n");
  await writeFile(join(root, "apps/web/dist/index.html"), "<main>release</main>\n");
  await writeFile(join(root, "apps/web/dist/assets/app.js"), "console.log('release');\n");
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("release artifacts", () => {
  test("verifies the exact commit, lockfile, Worker, and web build", async () => {
    const root = await releaseRoot();
    await createReleaseManifest(root, commitSha);

    await expect(verifyReleaseManifest(root, commitSha)).resolves.toMatchObject({ commitSha });
  });

  test("rejects a modified or unexpected deployable file", async () => {
    const root = await releaseRoot();
    await createReleaseManifest(root, commitSha);
    await writeFile(join(root, "apps/web/dist/assets/app.js"), "console.log('tampered');\n");

    await expect(verifyReleaseManifest(root, commitSha)).rejects.toThrow(
      "Release artifact verification failed",
    );

    await createReleaseManifest(root, commitSha);
    await writeFile(join(root, "apps/web/dist/unexpected.txt"), "unexpected\n");
    await expect(verifyReleaseManifest(root, commitSha)).rejects.toThrow(
      "Release artifact verification failed",
    );
  });

  test("rejects lockfile or commit drift", async () => {
    const root = await releaseRoot();
    await createReleaseManifest(root, commitSha);
    await writeFile(join(root, "package-lock.json"), '{"lockfileVersion":2}\n');

    await expect(verifyReleaseManifest(root, commitSha)).rejects.toThrow("lockfile does not match");

    const manifest = JSON.parse(await readFile(join(root, "release-manifest.json"), "utf8"));
    expect(manifest.commitSha).toBe(commitSha);
    await expect(
      verifyReleaseManifest(root, "abcdef0123456789abcdef0123456789abcdef01"),
    ).rejects.toThrow("Release commit mismatch");
  });
});
