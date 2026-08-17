import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const sourceRoot = join(process.cwd(), "apps/worker/src");
const approvedClient = "organization/rpc/client.ts";
const requireFinalRpcCutover = process.argv.includes("--final");

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });
}

function matches(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => {
    const offset = match.index ?? 0;
    return source.slice(0, offset).split("\n").length;
  });
}

const failures = [];
for (const file of sourceFiles(sourceRoot)) {
  const relativePath = relative(sourceRoot, file).replaceAll("\\", "/");
  const source = readFileSync(file, "utf8");
  if (
    requireFinalRpcCutover &&
    relativePath === "organization/OrganizationStore.ts" &&
    /override\s+async\s+fetch\s*\(/.test(source)
  ) {
    failures.push(
      `${relativePath}: legacy fetch adapter remains; remove it after first-release staging qualification`,
    );
  }
  if (relativePath !== approvedClient) {
    const namespaceAccessLines = matches(
      source,
      /ORGANIZATION_STORE\s*\.\s*(?:get|idFromName|getByName)\s*\(/g,
    );
    for (const line of namespaceAccessLines) {
      failures.push(`${relativePath}:${line}: direct Organization namespace access`);
    }
  }

  // The public Worker entry point owns the HTTP fetches for the router and static assets. Every
  // other production fetch call would be an internal Durable Object transport after the RPC cutover.
  if (relativePath !== "index.ts") {
    const fetchLines = matches(source, /\.\s*fetch\s*\(/g);
    for (const line of fetchLines) {
      failures.push(`${relativePath}:${line}: internal .fetch() call; use typed Organization RPC`);
    }
  }
}

if (failures.length > 0) {
  console.error("Durable Object boundary check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  "Durable Object boundary check passed: namespace access is centralized and production callers use RPC.",
);
