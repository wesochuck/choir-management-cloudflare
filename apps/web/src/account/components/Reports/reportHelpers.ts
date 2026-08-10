import {
  type DonationRecord,
  type OrganizationAttendanceRow,
  type OrganizationEvent,
  type OrganizationTicketOrder,
} from "@choir/contracts";

import type { CommerceFilter, CommerceRow, ReportTab, SingerAttendance } from "./shared";

export const TAB_LABELS: readonly { id: ReportTab; label: string }[] = [
  { id: "attendance", label: "Attendance" },
  { id: "rsvp", label: "RSVP" },
  { id: "repertoire", label: "Repertoire" },
  { id: "roster", label: "Roster" },
  { id: "donations-tickets", label: "Donations & Ticket Sales" },
  { id: "music-folders", label: "Music Folder Report" },
];

export function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
  }).format(date);
}

export function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { currency: "USD", style: "currency" }).format(
    cents / 100,
  );
}

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function downloadCsv(
  filename: string,
  rows: readonly (readonly (string | number)[])[],
): void {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

export function reportEvents(events: readonly OrganizationEvent[]): readonly OrganizationEvent[] {
  return events
    .filter((event) => event.type === "Performance" && !event.isCanceled)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export function eventLabel(event: OrganizationEvent): string {
  return `${event.title} · ${formatDate(event.startsAt, true)}`;
}

export function aggregateAttendance(
  rowsByRehearsal: readonly (readonly OrganizationAttendanceRow[])[],
): readonly SingerAttendance[] {
  const aggregate = new Map<string, SingerAttendance>();
  for (const rows of rowsByRehearsal) {
    for (const row of rows) {
      const previous = aggregate.get(row.profileId);
      const next: SingerAttendance = previous ?? {
        absences: 0,
        name: row.displayName,
        present: 0,
        profileId: row.profileId,
        total: 0,
        voicePart: row.voicePart,
      };
      aggregate.set(row.profileId, {
        ...next,
        absences: next.absences + (row.attendance === "Absent" ? 1 : 0),
        present: next.present + (row.attendance === "Present" ? 1 : 0),
        total: next.total + 1,
      });
    }
  }
  return [...aggregate.values()].sort(
    (a, b) => b.absences - a.absences || a.name.localeCompare(b.name),
  );
}

export function commerceRowDate(row: CommerceRow): string {
  return row.record.createdAt;
}

export function commerceRowAmount(row: CommerceRow): number {
  return row.kind === "donation" ? row.record.amountCents : row.record.amountPaidCents;
}

export function commerceRowDetails(row: CommerceRow): string {
  return row.kind === "donation"
    ? row.record.tributeName || "—"
    : `${row.record.eventTitle}${row.record.bundleTitle ? ` · ${row.record.bundleTitle}` : ""}`;
}

export function commerceRowEmail(row: CommerceRow): string {
  return row.kind === "donation" && row.record.anonymous ? "" : row.record.buyerEmail;
}

export function commerceRowFee(row: CommerceRow): number {
  return row.record.feeCents;
}

export function commerceRowName(row: CommerceRow): string {
  return row.kind === "donation" && row.record.anonymous ? "Anonymous" : row.record.buyerName;
}

export function commerceRowQuantity(row: CommerceRow): number | null {
  return row.kind === "ticket" ? row.record.quantity : null;
}

export function commerceRowType(row: CommerceRow): string {
  return row.kind === "donation" ? "Donation" : "Ticket sale";
}

export function commerceRows(
  donations: readonly DonationRecord[],
  ticketOrders: readonly OrganizationTicketOrder[],
  filter: CommerceFilter,
): readonly CommerceRow[] {
  const rows: CommerceRow[] = [];
  if (filter !== "tickets") {
    rows.push(...donations.map((record) => ({ kind: "donation" as const, record })));
  }
  if (filter !== "donations") {
    rows.push(...ticketOrders.map((record) => ({ kind: "ticket" as const, record })));
  }
  return rows.toSorted((left, right) =>
    commerceRowDate(right).localeCompare(commerceRowDate(left)),
  );
}
