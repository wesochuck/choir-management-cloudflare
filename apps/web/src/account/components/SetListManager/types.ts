import type {
  OrganizationEvent,
  OrganizationMusicPiece,
  OrganizationProfile,
} from "@choir/contracts";

export type SetListItem = OrganizationEvent["setList"][number];

export type PerformerCredit = NonNullable<SetListItem["performerCredits"]>[number];

export interface Resources {
  readonly events: readonly OrganizationEvent[];
  readonly music: readonly OrganizationMusicPiece[];
  readonly profiles: readonly OrganizationProfile[];
}

export interface SetListPrintRow {
  readonly arranger: string;
  readonly composer: string;
  readonly performers: string;
  readonly title: string;
}

export interface SetListPreviewRow extends SetListPrintRow {
  readonly kind: "intermission" | "song";
  readonly number: number | null;
}
