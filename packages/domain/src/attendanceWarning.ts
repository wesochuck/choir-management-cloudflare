/** The configured threshold is allowed; only counts strictly over it warn. */
export function hasAttendanceWarning(missedRehearsals: number, threshold: number): boolean {
  return missedRehearsals > threshold;
}
