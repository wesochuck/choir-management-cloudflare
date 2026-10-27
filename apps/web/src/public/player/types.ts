import type { LoudnessMeasurement } from "@choir/contracts";
declare global {
  interface Navigator {
    readonly audioSession?: {
      type: string;
    };
  }
}

export interface PlayerPlaylistItem {
  readonly loudnessByFileId?: Record<string, LoudnessMeasurement> | undefined;
  readonly arranger?: string | null | undefined;
  readonly composer?: string | null | undefined;
  readonly cueInstruction?: string | null | undefined;
  readonly durationSeconds?: number | null | undefined;
  readonly isFeaturedNumber?: boolean | null | undefined;
  readonly notes?: string | null | undefined;
  readonly pieceId?: string | null | undefined;
  readonly title: string;
  readonly trackFileIds: Record<string, string>;
  readonly type?: "intermission" | "song" | undefined;
}

export interface PlayerDetails {
  readonly loudnessByFileId?: Record<string, LoudnessMeasurement> | undefined;
  readonly eventArtworkFileId?: string | null | undefined;
  readonly eventId: string;
  readonly eventTitle: string;
  readonly eventStartsAt: string;
  readonly items: PlayerPlaylistItem[];
  readonly organizationName?: string | undefined;
  readonly performerLabel?: string | undefined;
  readonly profileName?: string | undefined;
  readonly trackLabels?: Record<string, string> | undefined;
}

export interface ResolvedTrack {
  readonly fallback: boolean;
  readonly fileId: string;
  readonly key: string;
  readonly pinned?: boolean;
}

export type PageStatus =
  | { readonly type: "loading" }
  | { readonly type: "no_token" }
  | { readonly type: "not_found" }
  | { readonly type: "offline" }
  | { readonly type: "ready"; readonly details: PlayerDetails }
  | { readonly type: "error" };
