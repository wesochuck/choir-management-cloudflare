import { spawn } from "node:child_process";
import net from "node:net";
import process from "node:process";

const root = new URL("..", import.meta.url);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const children = new Set();
const e2eEnvironment = {
  ...process.env,
  BETTER_AUTH_SECRET:
    process.env.BETTER_AUTH_SECRET?.trim() || "local-e2e-better-auth-secret-please-do-not-reuse",
  SIGNED_LINK_SECRET:
    process.env.SIGNED_LINK_SECRET?.trim() || "local-e2e-signed-link-secret-please-do-not-reuse",
  NO_COLOR: "1",
};
const e2eWorkerVariables = [
  "--var",
  `BETTER_AUTH_SECRET:${e2eEnvironment.BETTER_AUTH_SECRET}`,
  "--var",
  `SIGNED_LINK_SECRET:${e2eEnvironment.SIGNED_LINK_SECRET}`,
];

function start(args, cwd = root) {
  const child = spawn(npm, args, {
    cwd,
    env: e2eEnvironment,
    stdio: "inherit",
  });
  children.add(child);
  child.once("close", () => children.delete(child));
  return child;
}

function waitForPort(port, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let timer;
    const attempt = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        clearTimeout(timer);
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - startedAt >= timeoutMs) {
          clearTimeout(timer);
          reject(new Error(`Timed out waiting for port ${String(port)}.`));
          return;
        }
        timer = setTimeout(attempt, 250);
      });
    };
    attempt();
  });
}

async function run() {
  const build = start(["run", "build", "-w", "@choir/web"]);
  const buildExitCode = await new Promise((resolve, reject) => {
    build.once("error", reject);
    build.once("close", resolve);
  });
  if (buildExitCode !== 0) throw new Error("The web build failed before browser tests started.");

  const migrations = start([
    "run",
    "wrangler",
    "--",
    "d1",
    "migrations",
    "apply",
    "choir-management-control-local",
    "--local",
    "--config",
    "apps/worker/wrangler.jsonc",
  ]);
  const migrationExitCode = await new Promise((resolve, reject) => {
    migrations.once("error", reject);
    migrations.once("close", resolve);
  });
  if (migrationExitCode !== 0) {
    throw new Error("The local control-plane migrations failed before browser tests started.");
  }

  start(["run", "dev", "--", "--port", "8787", ...e2eWorkerVariables]);
  start(["run", "preview", "-w", "@choir/web", "--", "--host", "127.0.0.1", "--port", "4173"]);
  await Promise.all([waitForPort(8787), waitForPort(4173)]);
  await new Promise(() => undefined);
}

function stop() {
  for (const child of children) child.kill("SIGTERM");
}

process.once("SIGINT", () => {
  stop();
  process.exit(130);
});
process.once("SIGTERM", () => {
  stop();
  process.exit(143);
});

run().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  stop();
  process.exitCode = 1;
});
