import { z } from "zod";
import { loudnessResultSchema, type LoudnessMeasurement } from "@choir/contracts";
const claimSchema = z.object({
  claim: z
    .object({
      fileId: z.uuid(),
      claimId: z.uuid(),
      contentVersion: z.string(),
      sizeBytes: z.number(),
    })
    .nullable(),
});
export const statusesSchema = z.object({
  statuses: z.array(z.object({ status: z.string(), count: z.number().int().nonnegative() })),
});
export async function loudnessRequest(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`/api/organization/music/loudness${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  if (!response.ok)
    throw new Error(
      response.status === 409
        ? "Another administrator may be analyzing audio. Resume shortly."
        : "Audio analysis is unavailable. Your recordings are unchanged.",
    );
  return response.json();
}
let active = false;
let currentAnalysis: AbortController | null = null;
let uploadGeneration = 0;
export function pauseLoudnessAnalysis(): void {
  uploadGeneration++;
  currentAnalysis?.abort();
}
export function loudnessAnalysisEnabled(): boolean {
  return import.meta.env.VITE_PRACTICE_LOUDNESS_ENABLED === "true";
}
export async function runLoudnessBatch(
  options: { mode: "resume" | "retry_failed" | "reanalyze_all"; fileId?: string },
  sourceSignal: AbortSignal,
  onProgress: (text: string) => void,
  localFile?: File,
): Promise<void> {
  if (active) throw new Error("Audio analysis is already running in this tab.");
  active = true;
  const controller = new AbortController();
  currentAnalysis = controller;
  const abort = () => {
    controller.abort();
  };
  sourceSignal.addEventListener("abort", abort, { once: true });
  if (sourceSignal.aborted) controller.abort();
  const signal = controller.signal;
  try {
    await loudnessRequest("/start", options);
    let completed = 0;
    while (!signal.aborted) {
      const { claim } = claimSchema.parse(
        await loudnessRequest("/claim", { fileId: options.fileId }),
      );
      if (!claim) break;
      try {
        signal.throwIfAborted();
        const result = await analyzeClaim(
          claim,
          options.fileId === claim.fileId ? localFile : undefined,
          signal,
          (text) => {
            onProgress(`${String(completed)} completed · ${text}`);
          },
        );
        signal.throwIfAborted();
        const submission =
          "reasonCode" in result
            ? {
                analysisVersion: 1,
                contentVersion: claim.contentVersion,
                status: result.reasonCode === "unsupported_format" ? "unsupported" : "failed",
                reasonCode: result.reasonCode,
              }
            : { ...result, status: "ready" };
        await loudnessRequest("/result", {
          claimId: claim.claimId,
          fileId: claim.fileId,
          result: submission,
        });
        completed++;
        onProgress(`${String(completed)} recordings completed`);
      } finally {
        await loudnessRequest("/renew", { claimId: claim.claimId, release: true }).catch(
          () => undefined,
        );
      }
    }
  } finally {
    sourceSignal.removeEventListener("abort", abort);
    currentAnalysis = null;
    active = false;
  }
}
let uploadAnalysisQueue = Promise.resolve();
export function analyzeUploadedTrack(fileId: string, file: File): void {
  if (!loudnessAnalysisEnabled()) return;
  const generation = uploadGeneration;
  uploadAnalysisQueue = uploadAnalysisQueue
    .then(async () => {
      if (generation !== uploadGeneration) return;
      // Attachments are already pending durably, even if another tab holds the lease.
      await runLoudnessBatch(
        { mode: "resume", fileId },
        new AbortController().signal,
        () => undefined,
        file,
      );
    })
    .catch(() => undefined);
}

type Claim = NonNullable<z.infer<typeof claimSchema>["claim"]>;
interface Failure {
  reasonCode: "invalid_audio" | "unsupported_format" | "processing_limit" | "analysis_unavailable";
}
function parseWorkerResult(data: unknown, claim: Claim): LoudnessMeasurement | Failure | null {
  if (!data || typeof data !== "object" || !("type" in data)) return null;
  if (data.type === "ready" && "result" in data) {
    const raw = typeof data.result === "object" && data.result ? data.result : {};
    const parsed = loudnessResultSchema.parse({
      ...raw,
      status: "ready",
      contentVersion: claim.contentVersion,
    });
    return parsed.status === "ready" ? parsed : null;
  }
  if (data.type === "failed") {
    const parsed = loudnessResultSchema.parse({
      analysisVersion: 1,
      contentVersion: claim.contentVersion,
      status: "failed",
      reasonCode: "reasonCode" in data ? data.reasonCode : "analysis_unavailable",
    });
    return parsed.status === "ready" ? null : { reasonCode: parsed.reasonCode };
  }
  return null;
}
function analyzeClaim(
  claim: Claim,
  file: File | undefined,
  signal: AbortSignal,
  progress: (text: string) => void,
): Promise<LoudnessMeasurement | Failure> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), { type: "module" });
    const finish = () => {
      signal.removeEventListener("abort", cancel);
      clearInterval(renew);
      clearTimeout(timeout);
      worker.terminate();
    };
    const cancel = () => {
      finish();
      reject(new DOMException("Paused", "AbortError"));
    };
    const renew = setInterval(() => {
      void loudnessRequest("/renew", { claimId: claim.claimId }).catch(() => {
        finish();
        reject(new Error("The analysis claim expired. Resume to retry."));
      });
    }, 30000);
    const timeout = setTimeout(
      () => {
        finish();
        resolve({ reasonCode: "processing_limit" });
      },
      10 * 60 * 1000,
    );
    signal.addEventListener("abort", cancel, { once: true });
    worker.onerror = () => {
      finish();
      reject(new Error("Audio analysis could not start."));
    };
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (
        data &&
        typeof data === "object" &&
        "type" in data &&
        data.type === "progress" &&
        "bytes" in data &&
        typeof data.bytes === "number"
      ) {
        progress(
          `${String(Math.min(100, Math.round((100 * data.bytes) / claim.sizeBytes)))}% of current recording`,
        );
        return;
      }
      try {
        const result = parseWorkerResult(data, claim);
        if (result) {
          finish();
          resolve(result);
        }
      } catch {
        finish();
        reject(new Error("Invalid analysis result."));
      }
    };
    worker.postMessage(
      file ? { type: "analyze", file } : { type: "analyze", fileId: claim.fileId },
    );
    if (signal.aborted) cancel();
  });
}
