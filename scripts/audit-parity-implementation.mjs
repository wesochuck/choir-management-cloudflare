import { readFile, readdir } from "node:fs/promises";
import { parse } from "yaml";

const matrixUrl = new URL("../docs/parity/feature-matrix.yaml", import.meta.url);
const routerDirectoryUrl = new URL("../apps/worker/src/", import.meta.url);
const routeModulesDirectoryUrl = new URL("../apps/worker/src/routes/", import.meta.url);

const routeFileNames = ["router.ts"];

async function collectRouteFiles(directory, prefix) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await collectRouteFiles(`${directory}/${entry.name}`, relativePath)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(relativePath);
    }
  }
  return files;
}

try {
  routeFileNames.push(...(await collectRouteFiles(routeModulesDirectoryUrl.pathname, "routes")));
} catch (error) {
  if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
}
routeFileNames.sort();

const routeUrls = routeFileNames
  .filter(
    (fileName) =>
      fileName !== "routes/helpers.ts" &&
      !fileName.startsWith("routes/helpers/") &&
      fileName !== "routes/platformAdministration/shared.ts",
  )
  .map((fileName) => new URL(fileName, routerDirectoryUrl));
for (const routeUrl of routeUrls) {
  try {
    const source = await readFile(routeUrl, "utf8");
    if (
      routeUrl.pathname.includes("/routes/") &&
      !/register[A-Za-z0-9]*Routes\(router:\s*Hono<WorkerHonoEnvironment>\)/.test(source)
    ) {
      throw new Error(
        "route module must export registerRoutes(router: Hono<WorkerHonoEnvironment>)",
      );
    }
  } catch (error) {
    throw new Error(`Parity implementation audit route file is missing: ${routeUrl.pathname}`, {
      cause: error,
    });
  }
}

const matrix = parse(await readFile(matrixUrl, "utf8"));
const routePattern = /router\.(get|post|put|patch|delete)\(\s*(["'`])([^"'`]+)\2/g;
const sourceRoutes = new Set();
for (const routeUrl of routeUrls) {
  const routeSource = await readFile(routeUrl, "utf8");
  for (const match of routeSource.matchAll(routePattern)) {
    sourceRoutes.add(`${match[1].toUpperCase()} ${match[3]}`);
  }
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
    `Parity implementation audit passed: ${matrix.apiRoutes.length} API entries checked against ${routeUrls.length} Worker route files.`,
  );
}

const partial = matrix.apiRoutes.filter((entry) => entry.status === "partial");
if (partial.length > 0) {
  console.log(`Open API parity work: ${partial.length} partial entries.`);
}
