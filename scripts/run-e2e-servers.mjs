import { spawn } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

const root = new URL("..", import.meta.url);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const persistenceDir = await mkdtemp(join(tmpdir(), "choir-e2e-state-"));
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

async function assertWorkerPortAvailable() {
  const occupied = await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: 8787 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", (error) => {
      if (error.code === "ECONNREFUSED") resolve(false);
      else reject(error);
    });
  });
  if (occupied)
    throw new Error("Port 8787 already has a listener. Browser tests need a fresh local Worker.");
}

let workerRestarts = 0;
const maxWorkerRestarts = 3;

function startWorker() {
  const child = startChild([
    "run",
    "dev",
    "--",
    "--port",
    "8787",
    "--persist-to",
    persistenceDir,
    ...e2eWorkerVariables,
  ]);

  child.once("close", async (code, signal) => {
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
        await stop(1);
      }
    } else {
      console.error(
        `[run-e2e-servers] Worker dev server exited repeatedly (${String(maxWorkerRestarts)} times). Terminating E2E servers.`,
      );
      await stop(1);
    }
  });

  return child;
}

function startPreview() {
  const child = startChild([
    "run",
    "preview",
    "-w",
    "@choir/web",
    "--",
    "--host",
    "127.0.0.1",
    "--port",
    "4173",
    "--strictPort",
  ]);

  child.once("close", (code, signal) => {
    if (isShuttingDown) return;
    console.error(
      `[run-e2e-servers] Web preview server exited unexpectedly (code: ${String(code)}, signal: ${String(signal)}). Terminating E2E servers.`,
    );
    void stop(1);
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

async function runStep(args, failureMessage) {
  const child = startChild(args);
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  if (exitCode !== 0 && !isShuttingDown) throw new Error(failureMessage);
}

async function run() {
  await assertWorkerPortAvailable();
  if (process.env.RELEASE_QUALIFICATION === "1" && process.env.E2E_PREBUILT_WEB === "1") {
    await access(new URL("apps/web/dist/index.html", root));
    console.log("Using the web assets built by check:ci for browser qualification.");
  } else {
    await runStep(
      ["run", "build", "-w", "@choir/web"],
      "The web build failed before browser tests started.",
    );
  }
  if (isShuttingDown) return;

  await runStep(
    [
      "run",
      "wrangler",
      "--",
      "d1",
      "migrations",
      "apply",
      "choir-management-control-local",
      "--local",
      "--persist-to",
      persistenceDir,
      "--config",
      "apps/worker/wrangler.jsonc",
    ],
    "The local control-plane migrations failed before browser tests started.",
  );
  if (isShuttingDown) return;

  startWorker();
  startPreview();
  await Promise.all([waitForPort(8787), waitForPort(4173)]);
  if (!isShuttingDown) startHeartbeat();
}

async function stop(exitCode) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  await Promise.all(
    [...children].map(
      (child) =>
        new Promise((resolve) => {
          child.once("close", resolve);
          child.kill("SIGTERM");
        }),
    ),
  );
  try {
    await rm(persistenceDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    console.error(`Unable to remove temporary browser-test state at ${persistenceDir}.`);
    exitCode = 1;
  }
  process.exit(exitCode);
}

process.on("SIGINT", () => void stop(130));
process.on("SIGTERM", () => void stop(143));

run().catch(async (error) => {
  if (isShuttingDown) return;
  console.error(error instanceof Error ? error.message : error);
  await stop(1);
});
