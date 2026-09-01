import type { SearchCategory, SearchResultItem } from "@choir/contracts";
import type { SqlStorageValue } from "@cloudflare/workers-types";

interface ProfileRow {
  readonly [column: string]: SqlStorageValue;
  readonly displayName: string;
  readonly email: string | null;
  readonly globalStatus: string | null;
  readonly id: string;
  readonly voicePart: string | null;
}

interface EventRow {
  readonly [column: string]: SqlStorageValue;
  readonly eventDate: string;
  readonly id: string;
  readonly kind: string;
  readonly locationName: string | null;
  readonly title: string;
}

interface MusicRow {
  readonly [column: string]: SqlStorageValue;
  readonly arranger: string | null;
  readonly composer: string | null;
  readonly id: string;
  readonly title: string;
}

interface PollRow {
  readonly [column: string]: SqlStorageValue;
  readonly expiresAt: string | null;
  readonly id: string;
  readonly title: string;
}

interface MetadataRow {
  readonly [column: string]: SqlStorageValue;
  readonly organizationId: string;
}

export interface SearchStoreStorage {
  readonly sql: {
    exec<T extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: readonly unknown[]
    ): {
      toArray(): T[];
    };
  };
}

export interface SearchStoreOptions {
  readonly category?: SearchCategory | undefined;
  readonly limit?: number | undefined;
  readonly organizationId: string | null;
  readonly query: string;
}

function searchRosterProfiles(
  storage: SearchStoreStorage,
  likePattern: string,
  limit: number,
): readonly SearchResultItem[] {
  try {
    const rows = storage.sql
      .exec<ProfileRow>(
        `SELECT id, display_name AS displayName, voice_part AS voicePart, email, global_status AS globalStatus
         FROM profiles
         WHERE display_name LIKE ? OR email LIKE ? OR voice_part LIKE ?
         ORDER BY display_name ASC
         LIMIT ?`,
        likePattern,
        likePattern,
        likePattern,
        limit,
      )
      .toArray();

    return rows.map((p) => ({
      badge: p.globalStatus ?? "Active",
      category: "roster",
      href: `/admin/roster?profileId=${p.id}`,
      id: `roster-${p.id}`,
      subtitle: [p.voicePart, p.email].filter(Boolean).join(" • "),
      title: p.displayName,
    }));
  } catch {
    return [];
  }
}

function searchEvents(
  storage: SearchStoreStorage,
  likePattern: string,
  limit: number,
): readonly SearchResultItem[] {
  try {
    const rows = storage.sql
      .exec<EventRow>(
        `SELECT id, title, kind, event_date AS eventDate, location_name AS locationName
         FROM events
         WHERE title LIKE ? OR location_name LIKE ?
         ORDER BY event_date DESC
         LIMIT ?`,
        likePattern,
        likePattern,
        limit,
      )
      .toArray();

    return rows.map((e) => ({
      badge: e.kind,
      category: "events",
      href: `/admin/events?eventId=${e.id}`,
      id: `event-${e.id}`,
      subtitle: [e.kind, e.eventDate, e.locationName].filter(Boolean).join(" • "),
      title: e.title,
    }));
  } catch {
    return [];
  }
}

function searchMusicPieces(
  storage: SearchStoreStorage,
  likePattern: string,
  limit: number,
): readonly SearchResultItem[] {
  try {
    const rows = storage.sql
      .exec<MusicRow>(
        `SELECT id, title, composer, arranger
         FROM music_pieces
         WHERE title LIKE ? OR composer LIKE ? OR arranger LIKE ?
         ORDER BY title ASC
         LIMIT ?`,
        likePattern,
        likePattern,
        likePattern,
        limit,
      )
      .toArray();

    return rows.map((m) => {
      const details = [
        m.composer ? `Composer: ${m.composer}` : "",
        m.arranger ? `Arr: ${m.arranger}` : "",
      ]
        .filter(Boolean)
        .join(" • ");

      return {
        badge: "Music",
        category: "music",
        href: `/admin/music?pieceId=${m.id}`,
        id: `music-${m.id}`,
        subtitle: details || undefined,
        title: m.title,
      };
    });
  } catch {
    return [];
  }
}

function searchPolls(
  storage: SearchStoreStorage,
  likePattern: string,
  limit: number,
): readonly SearchResultItem[] {
  try {
    const rows = storage.sql
      .exec<PollRow>(
        `SELECT id, title, expires_at AS expiresAt
         FROM polls
         WHERE title LIKE ?
         ORDER BY created_at DESC
         LIMIT ?`,
        likePattern,
        limit,
      )
      .toArray();

    return rows.map((pol) => ({
      badge: "Poll",
      category: "polls",
      href: `/admin/communications/polls?pollId=${pol.id}`,
      id: `poll-${pol.id}`,
      subtitle: pol.expiresAt ? `Expires: ${pol.expiresAt}` : undefined,
      title: pol.title,
    }));
  } catch {
    return [];
  }
}

export function searchOrganizationEntitiesFromStore(
  storage: SearchStoreStorage,
  options: SearchStoreOptions,
): Response {
  const metaRows = storage.sql
    .exec<MetadataRow>(
      "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
    )
    .toArray();
  const storedId = metaRows.at(0)?.organizationId;

  if (!storedId || (options.organizationId && storedId !== options.organizationId)) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }

  const cleanQuery = options.query.trim();
  if (!cleanQuery) {
    return Response.json({ results: [] });
  }

  const likePattern = `%${cleanQuery}%`;
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const results: SearchResultItem[] = [];

  const shouldSearch = (cat: SearchCategory) => !options.category || options.category === cat;

  if (shouldSearch("roster")) {
    results.push(...searchRosterProfiles(storage, likePattern, limit));
  }
  if (shouldSearch("events")) {
    results.push(...searchEvents(storage, likePattern, limit));
  }
  if (shouldSearch("music")) {
    results.push(...searchMusicPieces(storage, likePattern, limit));
  }
  if (shouldSearch("polls")) {
    results.push(...searchPolls(storage, likePattern, limit));
  }

  return Response.json({ results: results.slice(0, limit) });
}
