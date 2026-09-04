declare global {
  interface Navigator {
    readonly audioSession?: {
      type: string;
    };
  }
}

export interface PlayerPlaylistItem {
  readonly arranger?: string | null | undefined;
  readonly composer?: string | null | undefined;
  readonly durationSeconds?: number | null | undefined;
  readonly isFeaturedNumber?: boolean | null | undefined;
  readonly notes?: string | null | undefined;
  readonly pieceId?: string | null | undefined;
  readonly title: string;
  readonly trackFileIds: Record<string, string>;
}

export interface PlayerDetails {
  readonly eventArtworkFileId?: string | null | undefined;
  readonly eventId: string;
  readonly eventTitle: string;
  readonly eventStartsAt: string;
  readonly items: PlayerPlaylistItem[];
  readonly organizationName?: string | undefined;
  readonly performerLabel?: string | undefined;
  readonly profileName?: string | undefined;
}

export interface ResolvedTrack {
  readonly fallback: boolean;
  readonly fileId: string;
  readonly key: string;
}

export type PageStatus =
  | { readonly type: "loading" }
  | { readonly type: "no_token" }
  | { readonly type: "not_found" }
  | { readonly type: "offline" }
  | { readonly type: "ready"; readonly details: PlayerDetails }
  | { readonly type: "error" };
