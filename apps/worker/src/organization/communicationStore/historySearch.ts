import { zonedLocalDateTimeToUtc } from "@choir/domain";

const months: Readonly<Record<string, number>> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

function dateToken(text: string) {
  const named =
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+(\d{4})\b/.exec(
      text,
    );
  if (named)
    return {
      text: named[0],
      year: Number(named[2]),
      month: months[named[1] ?? ""] ?? 0,
      day: 1,
      singleDay: false,
    };
  const iso = /\b(\d{4})-(\d{2})(?:-(\d{2}))?\b/.exec(text);
  if (!iso) return null;
  return {
    text: iso[0],
    year: Number(iso[1]),
    month: Number(iso[2]),
    day: Number(iso[3] ?? 1),
    singleDay: iso[3] !== undefined,
  };
}
function dateRange(text: string, timezone: string) {
  const token = dateToken(text);
  if (!token) return null;
  const { year, month, day, singleDay } = token;
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const start = new Date(Date.UTC(year, month - 1, day));
  if (start.getUTCMonth() !== month - 1) return null;
  const end = singleDay
    ? new Date(Date.UTC(year, month - 1, day + 1))
    : new Date(Date.UTC(year, month, 1));
  const lower = zonedLocalDateTimeToUtc(`${start.toISOString().slice(0, 10)}T00:00`, timezone);
  const upper = zonedLocalDateTimeToUtc(`${end.toISOString().slice(0, 10)}T00:00`, timezone);
  return lower && upper ? { text: token.text, lower, upper } : null;
}

/** All terms narrow the server result before the existing keyset cursor and page limit. */
export function communicationHistorySearch(search: string, timezone: string) {
  const clauses: string[] = [];
  const bindings: string[] = [];
  const normalized = search.toLowerCase();
  const range = dateRange(normalized, timezone);
  if (range) {
    clauses.push("sort_timestamp >= ? AND sort_timestamp < ?");
    bindings.push(range.lower, range.upper);
  }
  const text = range ? normalized.replace(range.text, " ") : normalized;
  // instr treats %, _, apostrophes, and SQL syntax as literal user text.
  for (const term of text.split(/\s+/).filter(Boolean)) {
    clauses.push(`instr(lower(COALESCE(subject,'') || ' ' || COALESCE(eventTitle,'') || ' ' ||
      replace(COALESCE(autoKind,''),'_',' ') || ' ' || status || ' ' || channel || ' ' || sort_timestamp || ' ' ||
      CASE WHEN source_rank != 3 OR autoKind IS NOT NULL THEN 'automated automatic' ELSE 'manual' END), ?) > 0`);
    bindings.push(
      (
        {
          drafts: "draft",
          confirmations: "confirmation",
          reminders: "reminder",
          refunds: "refund",
          reports: "report",
        } as Readonly<Record<string, string>>
      )[term] ?? term,
    );
  }
  return { clauses, bindings };
}
