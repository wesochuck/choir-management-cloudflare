const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A filesystem-safe, readable UTC timestamp, appended before the extension. */
export function timestampedExportFilename(filename: string, exportedAt: Date): string {
  if (!Number.isFinite(exportedAt.getTime())) throw new RangeError("Invalid export date");
  const pad = (value: number): string => String(value).padStart(2, "0");
  const month = MONTHS[exportedAt.getUTCMonth()];
  if (!month) throw new RangeError("Invalid export month");
  const hour = exportedAt.getUTCHours();
  const stamp = `${String(exportedAt.getUTCFullYear())}-${month}-${pad(exportedAt.getUTCDate())}_${pad(hour % 12 || 12)}-${pad(exportedAt.getUTCMinutes())}-${pad(exportedAt.getUTCSeconds())}-${hour < 12 ? "AM" : "PM"}-UTC`;
  const extensionIndex = filename.lastIndexOf(".");
  const extension = extensionIndex > 0 ? filename.slice(extensionIndex) : "";
  const stem = extensionIndex > 0 ? filename.slice(0, extensionIndex) : filename;
  const suffix = `_${stamp}${extension}`;
  return `${stem.slice(0, Math.max(0, 255 - suffix.length))}${suffix}`;
}
