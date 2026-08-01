import type { DonationStatus, DonationTributeType } from "./donations";
import { lastNameSortKey } from "./name";

export interface DonationExportRow {
  readonly amountPaidCents: number;
  readonly anonymous: boolean;
  readonly createdAt: string;
  readonly donorEmail: string;
  readonly donorName: string;
  readonly id: string;
  readonly status: DonationStatus;
  readonly tributeName: string;
  readonly tributeType: DonationTributeType;
}

const dangerousFormulaPrefix = /^[=+\-@\t\r]/;

function csvField(value: string | number): string {
  const text = String(value);
  const safe = dangerousFormulaPrefix.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function formatAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

function anonymousSeparatorRow(): string {
  return ["", "ANONYMOUS DONORS", "", "", "", "", "", "", ""]
    .map((cell) => csvField(cell))
    .join(",");
}

function donationRow(row: DonationExportRow): string {
  return [
    row.id,
    row.donorName,
    row.donorEmail,
    formatAmount(row.amountPaidCents),
    row.tributeType,
    row.tributeName,
    row.anonymous ? "Yes" : "No",
    row.status,
    row.createdAt,
  ]
    .map(csvField)
    .join(",");
}

/**
 * Sort donations by creation timestamp descending, then donor name ascending
 * (last-name, then first-name). This mirrors the baseline DonationsView default
 * sort, which uses PocketBase `-created` plus an in-memory tiebreak.
 */
function sortDonations(rows: readonly DonationExportRow[]): readonly DonationExportRow[] {
  return [...rows].sort((left, right) => {
    const timeDiff = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    if (timeDiff !== 0) return timeDiff;
    return lastNameSortKey(left.donorName).localeCompare(lastNameSortKey(right.donorName));
  });
}

export function donationExportFilename(date: Date): string {
  const utcDate = date.toISOString().split("T")[0] ?? "unknown";
  return `donations_export_${utcDate}.csv`;
}

export function renderDonationCsv(rows: readonly DonationExportRow[]): string {
  const header = [
    "ID",
    "Donor Name",
    "Donor Email",
    "Amount",
    "Tribute",
    "Tribute Name",
    "Anonymous",
    "Status",
    "Date",
  ]
    .map(csvField)
    .join(",");

  if (rows.length === 0) {
    return `${header}\r\n`;
  }

  const sorted = sortDonations(rows);
  const named = sorted.filter((row) => !row.anonymous);
  const anonymous = sorted.filter((row) => row.anonymous);

  const lines = [header];
  lines.push(...named.map(donationRow));
  if (anonymous.length > 0) {
    lines.push(anonymousSeparatorRow());
    lines.push(...anonymous.map(donationRow));
  }

  return `${lines.join("\r\n")}\r\n`;
}
