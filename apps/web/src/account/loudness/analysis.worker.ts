import { analyzeMp3Stream } from "./analyzeMp3Stream";
import { Mp3AnalysisError } from "./mpegFrames";

const controller = new AbortController();
let running = false;
self.onmessage = (event: MessageEvent<unknown>) => {
  const data = event.data;
  if (!data || typeof data !== "object" || !("type" in data)) return;
  if (data.type === "cancel") {
    controller.abort();
    return;
  }
  if (data.type !== "analyze" || running) return;
  running = true;
  void (async () => {
    try {
      let stream: ReadableStream<Uint8Array>;
      if ("file" in data && data.file instanceof File) {
        stream = data.file.stream();
      } else if (
        "fileId" in data &&
        typeof data.fileId === "string" &&
        /^[0-9a-f-]{36}$/i.test(data.fileId)
      ) {
        const response = await fetch(`/api/organization/files/${data.fileId}`, {
          credentials: "same-origin",
          signal: controller.signal,
        });
        if (!response.ok || !response.body) throw new Mp3AnalysisError("invalid_audio");
        stream = response.body;
      } else throw new Mp3AnalysisError("invalid_audio");
      const result = await analyzeMp3Stream(stream, controller.signal, (bytes) => {
        self.postMessage({ type: "progress", bytes });
      });
      self.postMessage({ type: "ready", result });
    } catch (error: unknown) {
      self.postMessage({
        type: "failed",
        reasonCode: error instanceof Mp3AnalysisError ? error.reasonCode : "analysis_unavailable",
      });
    } finally {
      self.close();
    }
  })();
};
