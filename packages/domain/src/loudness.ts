/** Constant playback gain only; original bytes and musical dynamics stay unchanged. */
export const LOUDNESS_ANALYSIS_VERSION = 1;
export const LOUDNESS_TARGET_LUFS = -18;
export const LOUDNESS_CEILING_DBTP = -1;
const MAX_BOOST_DB = 18;

export function practiceLoudnessGain(
  measurement:
    | {
        readonly analysisVersion: number;
        readonly contentVersion: string;
        readonly integratedLufs: number;
        readonly truePeakDbtp: number;
        readonly targetLufs?: number | undefined;
      }
    | null
    | undefined,
): { appliedGainDb: number; linearGain: number; peakCapped: boolean; requestedGainDb: number } {
  const unity = { appliedGainDb: 0, linearGain: 1, peakCapped: false, requestedGainDb: 0 };
  if (measurement?.analysisVersion !== LOUDNESS_ANALYSIS_VERSION || !measurement.contentVersion)
    return unity;
  const { integratedLufs: loudness, truePeakDbtp: peak } = measurement;
  if (
    !Number.isFinite(loudness) ||
    !Number.isFinite(peak) ||
    loudness < -70 ||
    loudness > 0 ||
    peak < -100 ||
    peak > 12
  )
    return unity;
  const target = measurement.targetLufs;
  const targetLufs =
    target !== undefined && Number.isFinite(target) && target >= -30 && target <= -10
      ? target
      : LOUDNESS_TARGET_LUFS;
  const requestedGainDb = targetLufs - loudness;
  const headroom = LOUDNESS_CEILING_DBTP - peak;
  const appliedGainDb = Math.min(requestedGainDb, headroom, MAX_BOOST_DB);
  return {
    appliedGainDb,
    linearGain: 10 ** (appliedGainDb / 20),
    peakCapped: headroom < requestedGainDb,
    requestedGainDb,
  };
}
