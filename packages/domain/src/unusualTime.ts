/** Classifies a complete local clock value without converting it to UTC. */
export function isUnusualTime(value: string): boolean {
  const clock = value.includes("T") ? value.split("T")[1] : value;
  const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(clock ?? "");
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  if (hours > 23 || minutes > 59 || seconds > 59) return false;
  const time = hours * 3600 + minutes * 60 + seconds + Number(`0.${match[4] ?? "0"}`);
  return time < 12 * 3600 || time > 22 * 3600;
}
