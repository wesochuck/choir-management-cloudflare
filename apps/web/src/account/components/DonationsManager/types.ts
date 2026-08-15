import {
  donationRecordsResponseSchema,
  patronRecordsResponseSchema,
  type DonationRecord,
  type DonationSettings,
  type PatronRecord,
} from "@choir/contracts";

export type DonationState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly donations: readonly DonationRecord[]; readonly status: "ready" };

export type PatronState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly patrons: readonly PatronRecord[]; readonly status: "ready" };

export type DonationSettingsState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly settings: DonationSettings; readonly status: "ready" };

export type DonationTab = "history" | "levels" | "portal" | "pageSettings";
export type DonationSort = "dateDesc" | "dateAsc" | "donor";

export const EMPTY_DONATIONS: readonly DonationRecord[] = [];

export function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { currency: "USD", style: "currency" }).format(
    cents / 100,
  );
}

export function tributeLabel(type: string): string {
  switch (type) {
    case "honor":
      return "In Honor Of";
    case "memory":
      return "In Memory Of";
    case "anonymous":
      return "Anonymous";
    default:
      return "None";
  }
}

export function parseDonations(body: unknown): readonly DonationRecord[] {
  const parsed = donationRecordsResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.donations : [];
}

export function parsePatrons(body: unknown): readonly PatronRecord[] {
  const parsed = patronRecordsResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.patrons : [];
}

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function donationsCsv(donations: readonly DonationRecord[]): string {
  const rows = [
    ["Donor", "Email", "Amount", "Processing fee", "Tribute", "Status", "Date"],
    ...donations.map((donation) => [
      donation.anonymous ? "Anonymous" : donation.buyerName,
      donation.anonymous ? "" : donation.buyerEmail,
      money(donation.amountCents),
      money(donation.feeCents),
      `${tributeLabel(donation.tributeType)}${donation.tributeName ? `: ${donation.tributeName}` : ""}`,
      donation.status,
      donation.createdAt,
    ]),
  ];
  return rows.map((row) => row.map((value) => csvCell(value)).join(",")).join("\n");
}
