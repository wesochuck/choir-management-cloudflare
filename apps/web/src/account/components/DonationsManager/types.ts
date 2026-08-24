import {
  donationRecordsResponseSchema,
  patronRecordsResponseSchema,
  type DonationRecord,
  type DonationSettings,
  type PatronRecord,
} from "@choir/contracts";
import { renderDonationCsv, type DonationExportRow } from "@choir/domain";

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

export function donationsCsv(donations: readonly DonationRecord[]): string {
  const exportRows: DonationExportRow[] = donations.map((donation) => ({
    amountPaidCents: donation.amountCents,
    anonymous: donation.anonymous,
    createdAt: donation.createdAt,
    donorEmail: donation.anonymous ? "" : donation.buyerEmail,
    donorName: donation.anonymous ? "Anonymous" : donation.buyerName,
    id: donation.id,
    paymentMethod: donation.paymentMethod,
    paymentReference: donation.paymentReference,
    status: donation.status,
    thankYouSentAt: donation.thankYouSentAt,
    tributeName: donation.tributeName,
    tributeType: donation.tributeType,
  }));
  return renderDonationCsv(exportRows);
}
