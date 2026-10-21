import { MPEGDecoder, type MPEGDecodedAudio } from "mpg123-decoder";
import { LoudnessMeter } from "bravoh-loudness";
import { Mp3AnalysisError, MpegFrameReader, type MpegLayout } from "./mpegFrames";

export const ANALYZER_PROVENANCE = {
  analysisVersion: 1,
  decoderName: "mpg123-decoder",
  decoderVersion: "1.0.3",
  meterName: "bravoh-loudness",
  meterVersion: "0.1.0",
} as const;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_SECONDS = 2 * 60 * 60;
/** Runs only in the administrator worker. Retains at most one bounded PCM batch. */
export async function analyzeMp3Stream(
  input: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onProgress: (bytes: number) => void,
) {
  const decoder = new MPEGDecoder({ enableGapless: true });
  const reader = input.getReader();
  const frames = new MpegFrameReader();

  let bytes = 0;
  let samples = 0;
  let meter: LoudnessMeter | null = null;
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  let initialized = false;
  try {
    await decoder.ready;
    initialized = true;
    for (;;) {
      signal.throwIfAborted();
      const next = await reader.read();
      if (next.done) break;
      for (let offset = 0; offset < next.value.length; offset += 65536) {
        signal.throwIfAborted();
        const chunk = next.value.subarray(offset, offset + 65536);
        bytes += chunk.length;
        if (bytes > MAX_BYTES) throw new Mp3AnalysisError("processing_limit");
        frames.push(chunk);
        const decoded = decoder.decode(chunk);
        const processed = acceptDecoded(decoded, frames.layout, meter, samples);
        meter = processed.meter;
        samples = processed.samples;
        onProgress(bytes);
      }
    }
    signal.throwIfAborted();
    frames.finish();
    if (!meter || !samples) throw new Mp3AnalysisError("invalid_audio");
    const { integratedLufs, truePeakDbtp } = validatedResult(meter);
    const layout = frames.finish();
    return {
      ...ANALYZER_PROVENANCE,
      integratedLufs,
      truePeakDbtp,
      samples,
      sampleRate: layout.sampleRate,
    };
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
    if (initialized) decoder.free();
  }
}

function acceptDecoded(
  decoded: MPEGDecodedAudio,
  layout: MpegLayout | null,
  meter: LoudnessMeter | null,
  samples: number,
) {
  if (decoded.errors.length) throw new Mp3AnalysisError("invalid_audio");
  if (!decoded.samplesDecoded) return { meter, samples };
  if (decoded.sampleRate !== layout?.sampleRate || decoded.channelData.length !== 2)
    throw new Mp3AnalysisError("invalid_audio");
  const activeMeter =
    meter ?? new LoudnessMeter({ channels: layout.channels, sampleRateHz: layout.sampleRate });
  const total = samples + decoded.samplesDecoded;
  if (total / layout.sampleRate > MAX_SECONDS) throw new Mp3AnalysisError("processing_limit");
  activeMeter.push(decoded.channelData.slice(0, layout.channels));
  return { meter: activeMeter, samples: total };
}
function validatedResult(meter: LoudnessMeter) {
  const result = meter.result();
  const { integratedLufs: loudness, truePeakDbtp: peak } = result;
  if (
    !Number.isFinite(loudness) ||
    !Number.isFinite(peak) ||
    loudness < -70 ||
    loudness > 0 ||
    peak < -100 ||
    peak > 12
  )
    throw new Mp3AnalysisError("invalid_audio");
  return result;
}
