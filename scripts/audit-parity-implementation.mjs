import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const matrixUrl = new URL("../docs/parity/feature-matrix.yaml", import.meta.url);
const routerUrl = new URL("../apps/worker/src/router.ts", import.meta.url);

const matrix = parse(await readFile(matrixUrl, "utf8"));
const routerSource = await readFile(routerUrl, "utf8");
const routePattern = /router\.(get|post|put|patch|delete)\(\s*(["'`])([^"'`]+)\2/g;
const sourceRoutes = new Set();
for (const match of routerSource.matchAll(routePattern)) {
  sourceRoutes.add(`${match[1].toUpperCase()} ${match[3]}`);
}

const missing = [];
for (const entry of matrix.apiRoutes) {
  const route = `${entry.method} ${entry.path}`;
  if (!sourceRoutes.has(route) && !["partial", "blocked", "planned"].includes(entry.status)) {
    missing.push({ id: entry.id, route, status: entry.status });
  }
}

if (missing.length > 0) {
  console.error("Parity entries claim implementation without a matching Worker route:");
  for (const entry of missing) {
    console.error(`- ${entry.id}: ${entry.route} (${entry.status})`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Parity implementation audit passed: ${matrix.apiRoutes.length} API entries checked against apps/worker/src/router.ts.`,
  );
}

const partial = matrix.apiRoutes.filter((entry) => entry.status === "partial");
if (partial.length > 0) {
  console.log(`Open API parity work: ${partial.length} partial entries.`);
}
