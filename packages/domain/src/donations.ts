export type DonationStatus = "expired" | "paid" | "pending" | "refunded";
export type DonationPaymentMethod =
  "stripe" | "check" | "cash" | "bank_transfer" | "card_offline" | "other";
export type DonationTributeType = "honor" | "memory" | "anonymous" | "none";

export interface DonationInput {
  readonly amountCents: number;
  readonly anonymous: boolean;
  readonly marketingConsent: boolean;
  readonly paymentMethod?: DonationPaymentMethod;
  readonly paymentReference?: string;
  readonly thankYouSentAt?: string | null;
  readonly tributeName: string;
  readonly tributeNotifyEmail: string;
  readonly tributeType: DonationTributeType;
}

export interface DonationRecord {
  readonly amountCents: number;
  readonly anonymous: boolean;
  readonly buyerEmail: string;
  readonly buyerName: string;
  readonly createdAt: string;
  readonly id: string;
  readonly marketingConsent: boolean;
  readonly patronId: string | null;
  readonly paymentMethod?: DonationPaymentMethod;
  readonly paymentReference?: string;
  readonly status: DonationStatus;
  readonly thankYouSentAt?: string | null;
  readonly tributeName: string;
  readonly tributeNotifyEmail: string;
  readonly tributeType: DonationTributeType;
  readonly updatedAt: string;
}

export interface PatronRecord {
  readonly donationCount: number;
  readonly email: string;
  readonly firstDonatedAt: string;
  readonly id: string;
  readonly lastDonatedAt: string;
  readonly name: string;
  readonly totalDonatedCents: number;
}

export function canSetDonationThankYouStatus(
  donationStatus: DonationStatus,
  thankYouSent: boolean,
): boolean {
  return donationStatus !== "refunded" || !thankYouSent;
}

export function canTransitionDonation(current: DonationStatus, next: DonationStatus): boolean {
  return (
    current === next ||
    (current === "pending" && next === "paid") ||
    (current === "pending" && next === "expired") ||
    (current === "expired" && next === "paid") ||
    (current === "paid" && next === "refunded")
  );
}
