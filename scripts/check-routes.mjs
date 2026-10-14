import { readFile, readdir } from "node:fs/promises";

const routerDirectoryUrl = new URL("../apps/worker/src/", import.meta.url);
const routeModulesDirectoryUrl = new URL("../apps/worker/src/routes/", import.meta.url);

export async function collectRouteFiles(directory, prefix) {
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

export async function discoverWorkerRoutes() {
  const routeFileNames = ["router.ts"];
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
    .map((fileName) => ({
      fileName,
      url: new URL(fileName, routerDirectoryUrl),
    }));

  const routePattern = /router\.(get|post|put|patch|delete)\(\s*(["'`])([^"'`]+)\2/g;
  const routes = [];
  const routeModuleErrors = [];

  for (const { fileName, url } of routeUrls) {
    let source;
    try {
      source = await readFile(url, "utf8");
    } catch (error) {
      throw new Error(`Route file missing: ${url.pathname}`, { cause: error });
    }

    if (
      url.pathname.includes("/routes/") &&
      !/register[A-Za-z0-9]*Routes\(router:\s*Hono<WorkerHonoEnvironment>\)/.test(source)
    ) {
      routeModuleErrors.push(
        `${fileName}: route module must export register*Routes(router: Hono<WorkerHonoEnvironment>)`,
      );
    }

    for (const match of source.matchAll(routePattern)) {
      routes.push({
        file: fileName,
        id: `${match[1].toUpperCase()} ${match[3]}`,
        method: match[1].toUpperCase(),
        path: match[3],
      });
    }
  }

  if (routeModuleErrors.length > 0) {
    throw new Error(
      `Route module export check failed:\n${routeModuleErrors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }

  return { routeUrls, routes };
}

export async function validateWorkerRoutes() {
  const { routeUrls, routes } = await discoverWorkerRoutes();

  const seen = new Map();
  const duplicates = [];
  const invalidPaths = [];

  for (const entry of routes) {
    const key = `${entry.method} ${entry.path}`;
    if (seen.has(key)) {
      duplicates.push({ entry, previous: seen.get(key) });
    } else {
      seen.set(key, entry);
    }

    if (!entry.path.startsWith("/api/")) {
      invalidPaths.push(entry);
    }
  }

  if (duplicates.length > 0) {
    console.error("Duplicate Worker routes detected:");
    for (const { entry, previous } of duplicates) {
      console.error(
        `  - ${entry.method} ${entry.path} defined in both ${previous.file} and ${entry.file}`,
      );
    }
    process.exitCode = 1;
    return false;
  }

  if (invalidPaths.length > 0) {
    console.error("Invalid route paths detected (must start with /api/):");
    for (const entry of invalidPaths) {
      console.error(`  - ${entry.method} ${entry.path} (${entry.file})`);
    }
    process.exitCode = 1;
    return false;
  }

  console.log(
    `Route registration check passed: ${routes.length} API routes registered across ${routeUrls.length} Worker route files.`,
  );
  return true;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  validateWorkerRoutes().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
