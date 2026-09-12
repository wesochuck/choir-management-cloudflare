import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import process from "node:process";

const root = new URL("..", import.meta.url);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const children = new Set();
let isShuttingDown = false;
let heartbeatTimer = null;

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

function startChild(args, cwd = root) {
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

let workerRestarts = 0;
const maxWorkerRestarts = 3;

function startWorker() {
  const child = spawn(npm, ["run", "dev", "--", "--port", "8787", ...e2eWorkerVariables], {
    cwd: root,
    env: e2eEnvironment,
    stdio: "inherit",
  });
  children.add(child);

  child.once("close", async (code, signal) => {
    children.delete(child);
    if (isShuttingDown) return;

    if (workerRestarts < maxWorkerRestarts) {
      workerRestarts += 1;
      console.warn(
        `[run-e2e-servers] Worker dev server exited unexpectedly (code: ${String(code)}, signal: ${String(signal)}). Attempting restart ${String(workerRestarts)}/${String(maxWorkerRestarts)}...`,
      );
      try {
        startWorker();
        await waitForPort(8787, 30_000);
        console.log("[run-e2e-servers] Worker dev server successfully restarted on port 8787.");
      } catch (error) {
        console.error("[run-e2e-servers] Failed to restart worker dev server:", error);
        stop();
        process.exit(1);
      }
    } else {
      console.error(
        `[run-e2e-servers] Worker dev server exited repeatedly (${String(maxWorkerRestarts)} times). Terminating E2E servers.`,
      );
      stop();
      process.exit(1);
    }
  });

  return child;
}

function startPreview() {
  const child = spawn(
    npm,
    ["run", "preview", "-w", "@choir/web", "--", "--host", "127.0.0.1", "--port", "4173"],
    {
      cwd: root,
      env: e2eEnvironment,
      stdio: "inherit",
    },
  );
  children.add(child);

  child.once("close", (code, signal) => {
    children.delete(child);
    if (isShuttingDown) return;
    console.error(
      `[run-e2e-servers] Web preview server exited unexpectedly (code: ${String(code)}, signal: ${String(signal)}). Terminating E2E servers.`,
    );
    stop();
    process.exit(1);
  });

  return child;
}

function startHeartbeat(intervalMs = 5_000) {
  heartbeatTimer = setInterval(() => {
    if (isShuttingDown) return;
    const req = http.get("http://127.0.0.1:8787/api/health", { timeout: 3_000 }, (res) => {
      res.resume();
    });
    req.on("error", () => {
      // Ignored: transient network or restart in flight
    });
    req.on("timeout", () => {
      req.destroy();
    });
  }, intervalMs);
  heartbeatTimer.unref();
}

async function run() {
  const build = startChild(["run", "build", "-w", "@choir/web"]);
  const buildExitCode = await new Promise((resolve, reject) => {
    build.once("error", reject);
    build.once("close", resolve);
  });
  if (buildExitCode !== 0) throw new Error("The web build failed before browser tests started.");

  const migrations = startChild([
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

  startWorker();
  startPreview();
  await Promise.all([waitForPort(8787), waitForPort(4173)]);
  startHeartbeat();
  await new Promise(() => undefined);
}

function stop() {
  isShuttingDown = true;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
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
