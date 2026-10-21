import { createServer } from "node:http";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { chromium } from "@playwright/test";
const inputPath = process.argv[2];
if (!inputPath)
  throw new Error("Usage: node scripts/benchmark-loudness-browser.mjs /path/to/synthetic.mp3");
if (statSync(inputPath).size > 20 * 1024 * 1024)
  throw new Error("The benchmark input must be at most 20 MiB.");
const workerName = readdirSync("apps/web/dist/assets").find((name) =>
  /^analysis\.worker-.*\.js$/.test(name),
);
const workerBody = readFileSync("apps/web/dist/assets/" + workerName);
const audio = readFileSync(inputPath);
const csp = readFileSync("apps/web/public/_headers", "utf8")
  .split("\n")
  .find((line) => line.includes("Content-Security-Policy:"))
  .split("Content-Security-Policy:")[1]
  .trim();
const server = createServer((req, res) => {
  res.setHeader("Content-Security-Policy", csp);
  if (req.url === "/worker.js") {
    res.setHeader("Content-Type", "text/javascript");
    res.end(workerBody);
  } else if (req.url === "/audio.mp3") {
    res.setHeader("Content-Type", "audio/mpeg");
    res.end(audio);
  } else res.end("<!doctype html><title>Local loudness benchmark</title>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let timer;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:" + server.address().port);
  const cdp = await browser.newBrowserCDPSession();
  let peakHeap = 0;
  let peakBacking = 0;
  let samples = 0;
  page.on("worker", async () => {
    const { targetInfos } = await cdp.send("Target.getTargets");
    const target = targetInfos.find(
      (value) => value.type === "worker" && value.url.endsWith("/worker.js"),
    );
    if (!target) return;
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: false,
    });
    let id = 0;
    cdp.on("Target.receivedMessageFromTarget", (event) => {
      if (event.sessionId !== sessionId) return;
      const data = JSON.parse(event.message);
      if (data.result && typeof data.result.usedSize === "number") {
        samples++;
        peakHeap = Math.max(peakHeap, data.result.usedSize);
        peakBacking = Math.max(peakBacking, data.result.backingStorageSize ?? 0);
      }
    });
    timer = setInterval(() => {
      void cdp
        .send("Target.sendMessageToTarget", {
          sessionId,
          message: JSON.stringify({ id: ++id, method: "Runtime.getHeapUsage" }),
        })
        .catch(() => undefined);
    }, 100);
  });
  const start = Date.now();
  const result = await page.evaluate(async () => {
    let ticks = 0;
    const timer = setInterval(() => ticks++, 50);
    const body = await (await fetch("/audio.mp3")).blob();
    const worker = new globalThis.Worker("/worker.js", { type: "module" });
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error("Benchmark timeout"));
      }, 600000);
      worker.onerror = (error) => {
        clearInterval(timer);
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(error.message));
      };
      worker.onmessage = (event) => {
        if (event.data.type === "ready" || event.data.type === "failed") {
          clearInterval(timer);
          clearTimeout(timeout);
          worker.terminate();
          resolve({ ticks, ...event.data });
        }
      };
      worker.postMessage({
        type: "analyze",
        file: new File([body], "maximum.mp3", { type: "audio/mpeg" }),
      });
    });
  });
  clearInterval(timer);
  console.log(
    JSON.stringify({
      peakHeap,
      peakBacking,
      heapSamples: samples,
      browser: await browser.version(),
      bytes: statSync(inputPath).size,
      elapsedMs: Date.now() - start,
      ...result,
    }),
  );
} finally {
  clearInterval(timer);
  await browser.close();
  server.close();
}
