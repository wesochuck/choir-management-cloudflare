import { playerMediaUrl } from "./format";

/**
 * Where practice bytes come from. The public route uses a signed-link token; the member app
 * will supply a session source. The player UI only ever sees URLs — tokens stay in the live
 * page URL and are never persisted.
 */
export interface PracticeTrackSource {
  readonly kind: "token" | "session";
  artworkUrl(fileId: string): string;
  mediaUrl(fileId: string): string;
}

export function createTokenTrackSource(token: string): PracticeTrackSource {
  return {
    artworkUrl(fileId: string): string {
      return playerMediaUrl(fileId, token);
    },
    kind: "token",
    mediaUrl(fileId: string): string {
      return playerMediaUrl(fileId, token);
    },
  };
}

export function createSessionTrackSource(): PracticeTrackSource {
  return {
    artworkUrl(fileId: string): string {
      return `/api/organization/files/${encodeURIComponent(fileId)}`;
    },
    kind: "session",
    mediaUrl(fileId: string): string {
      return `/api/organization/files/${encodeURIComponent(fileId)}`;
    },
  };
}
