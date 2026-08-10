import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const repositoryRoot = new URL("../", import.meta.url);

const thresholds = new Map([
  [".ts", 800],
  [".tsx", 800],
  [".css", 700],
]);

const allowlistedFiles = new Set([
  "apps/worker/src/organization/schema/migrations.ts",
  "apps/worker/src/organization/statusAutomationStore.ts",
  "apps/worker/src/organization/musicFolderReportStore.ts",
]);

function thresholdFor(file) {
  for (const [extension, threshold] of thresholds) {
    if (file.endsWith(extension)) return threshold;
  }
  return undefined;
}

const { stdout } = await execFile("git", ["ls-files"], { cwd: repositoryRoot });
const files = stdout.split("\n").filter(Boolean);
const candidates = [];

for (const file of files) {
  const threshold = thresholdFor(file);
  if (threshold === undefined || allowlistedFiles.has(file)) continue;

  const content = await readFile(new URL(file, repositoryRoot), "utf8");
  const lines = content === "" ? 0 : content.split("\n").length;
  if (lines >= threshold) candidates.push({ file, lines, threshold });
}

candidates.sort((left, right) => right.lines - left.lines || left.file.localeCompare(right.file));

console.log("Large tracked source files (informational; allowlisted cohesive files omitted):");
if (candidates.length === 0) {
  console.log("No files exceeded the configured thresholds.");
} else {
  for (const candidate of candidates) {
    console.log(
      `${String(candidate.lines).padStart(5)} lines  threshold ${String(candidate.threshold).padStart(3)}  ${candidate.file}`,
    );
  }
}
