// Verify every package.json dependency is recorded in package-lock.json.
// Runs against the working tree by default; with --staged it reads the staged
// blobs (used by the pre-commit hook) so a manifest staged without its
// lockfile update is caught before the commit lands.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const staged = process.argv.includes("--staged");

function readStaged(path) {
  return execFileSync("git", ["show", `:${path}`], { encoding: "utf8" });
}

function readTree(path) {
  return readFileSync(path, "utf8");
}

const read = staged ? readStaged : readTree;

const lockfile = JSON.parse(read("package-lock.json"));
const lockEntries = lockfile.packages ?? {};

function workspaceKey(manifestPath) {
  // Lockfile v3 keys workspace manifests by their relative path (e.g.
  // "apps/web"); the root manifest is the empty key.
  return manifestPath === "package.json" ? "" : manifestPath.replace(/\/package\.json$/, "");
}

const failures = [];
for (const manifestPath of ["package.json", "apps/web/package.json"]) {
  const manifest = JSON.parse(read(manifestPath));
  const key = workspaceKey(manifestPath);
  const entry = lockEntries[key];
  if (!entry) {
    failures.push(`${manifestPath}: no lockfile entry at "${key}"`);
    continue;
  }
  for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
    for (const [name, range] of Object.entries(manifest[section] ?? {})) {
      const recorded = entry[section]?.[name];
      if (recorded === undefined) {
        failures.push(
          `${manifestPath}: ${name}@${range} (${section}) is missing from the lockfile`,
        );
      } else if (typeof recorded === "string" && recorded !== range) {
        failures.push(
          `${manifestPath}: ${name} range mismatch — manifest ${range}, lockfile ${recorded}`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error(
    "Lockfile out of sync with the package manifests:" +
      (staged ? "\nRun `npm install` and stage package-lock.json with the manifest change." : ""),
  );
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Lockfile matches the package manifests.");
