import { z } from "zod";

export const loudnessMeasurementSchema = z.object({
  analysisVersion: z.literal(1),
  contentVersion: z.string().min(1).max(256),
  integratedLufs: z.number().min(-70).max(0),
  truePeakDbtp: z.number().min(-100).max(12),
});
export type LoudnessMeasurement = z.infer<typeof loudnessMeasurementSchema>;
export const loudnessByFileIdSchema = z.record(z.uuid(), loudnessMeasurementSchema);
export const loudnessResultSchema = z.discriminatedUnion("status", [
  loudnessMeasurementSchema.extend({ status: z.literal("ready") }),
  z.object({
    analysisVersion: z.literal(1),
    contentVersion: z.string().min(1).max(256),
    status: z.enum(["failed", "unsupported"]),
    reasonCode: z.enum([
      "invalid_audio",
      "unsupported_format",
      "processing_limit",
      "analysis_unavailable",
    ]),
  }),
]);
export const loudnessSubmitSchema = z.object({
  claimId: z.uuid(),
  fileId: z.uuid(),
  result: loudnessResultSchema,
});
export const loudnessStartSchema = z.object({
  mode: z.enum(["resume", "retry_failed", "reanalyze_all"]).default("resume"),
  fileId: z.uuid().optional(),
});
