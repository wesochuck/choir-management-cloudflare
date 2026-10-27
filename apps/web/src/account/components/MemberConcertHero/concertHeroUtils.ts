export function formatConcertDateTime(
  isoStartsAt: string,
  timezone: string,
): {
  readonly dateFormatted: string;
  readonly timeFormatted: string;
} {
  const date = new Date(isoStartsAt);
  if (isNaN(date.getTime())) {
    return { dateFormatted: isoStartsAt, timeFormatted: "" };
  }
  const dateFormatted = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
  const timeFormatted = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  return { dateFormatted, timeFormatted };
}

export function calculateConcertCountdown(
  now: Date,
  concertDate: Date,
  rehearsalsRemainingCount: number,
  totalRehearsalsFromWarning?: number | null,
) {
  const diffMs = concertDate.getTime() - now.getTime();
  const totalDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  const weeks = Math.floor(totalDays / 7);
  const days = totalDays % 7;

  const totalSegments =
    typeof totalRehearsalsFromWarning === "number" &&
    totalRehearsalsFromWarning >= rehearsalsRemainingCount
      ? totalRehearsalsFromWarning
      : Math.max(rehearsalsRemainingCount, 6);

  return {
    days,
    rehearsalsRemaining: rehearsalsRemainingCount,
    totalSegments,
    weeks,
  };
}
