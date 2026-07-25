export type DuesStatus = "pending" | "paid" | "refunded";

export interface SeasonInput {
  readonly name: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly duesAmountCents: number;
}

export interface DuesRecord {
  readonly amountCents: number;
  readonly createdAt: string;
  readonly id: string;
  readonly paidAt: string | null;
  readonly profileId: string;
  readonly seasonId: string;
  readonly status: DuesStatus;
  readonly updatedAt: string;
}

export function canTransitionDues(current: DuesStatus, next: DuesStatus): boolean {
  return (
    current === next ||
    (current === "pending" && next === "paid") ||
    (current === "paid" && next === "refunded")
  );
}
