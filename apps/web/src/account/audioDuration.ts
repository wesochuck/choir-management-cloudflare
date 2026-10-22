const AUDIO_METADATA_TIMEOUT_MS = 30_000;

export function extractAudioDurationFromUrl(
  url: string,
  signal?: AbortSignal,
): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = "metadata";
    let settled = false;

    const finish = (durationSeconds: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onError);
      audio.removeEventListener("loadedmetadata", onMetadata);
      audio.removeEventListener("error", onError);
      audio.src = "";
      audio.load();
      resolve(durationSeconds);
    };

    const onMetadata = (): void => {
      const duration = audio.duration;
      finish(Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null);
    };
    const onError = (): void => {
      finish(null);
    };
    const timeout = setTimeout(() => {
      finish(null);
    }, AUDIO_METADATA_TIMEOUT_MS);

    signal?.addEventListener("abort", onError, { once: true });
    if (signal?.aborted) {
      finish(null);
      return;
    }
    audio.addEventListener("loadedmetadata", onMetadata);
    audio.addEventListener("error", onError);
    audio.src = url;
    audio.load();
  });
}

export function extractAudioDuration(file: File, signal?: AbortSignal): Promise<number | null> {
  const url = URL.createObjectURL(file);
  return extractAudioDurationFromUrl(url, signal).finally(() => {
    URL.revokeObjectURL(url);
  });
}
