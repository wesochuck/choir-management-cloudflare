import type { SearchCategory, SearchResultItem } from "@choir/contracts";
import type { SqlStorageValue } from "@cloudflare/workers-types";

interface ProfileRow {
  readonly [column: string]: SqlStorageValue;
  readonly displayName: string;
  readonly globalStatus: string | null;
  readonly hidden: number;
  readonly id: string;
  readonly voicePart: string | null;
}

interface EventRow {
  readonly [column: string]: SqlStorageValue;
  readonly id: string;
  readonly location: string | null;
  readonly startsAt: string;
  readonly title: string;
  readonly type: string;
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
  readonly includeHidden?: boolean | undefined;
  readonly limit?: number | undefined;
  readonly organizationId: string | null;
  readonly profileIds?: readonly string[] | undefined;
  readonly query: string;
}

function searchRosterProfiles(
  storage: SearchStoreStorage,
  likePattern: string,
  profileIds: readonly string[],
  limit: number,
  includeHidden = false,
): readonly SearchResultItem[] {
  const hiddenFilter = includeHidden ? "" : "AND hidden = 0";
  const rows: ProfileRow[] =
    profileIds.length > 0
      ? storage.sql
          .exec<ProfileRow>(
            `SELECT id, display_name AS displayName, voice_part AS voicePart, global_status AS globalStatus, hidden
             FROM profiles
             WHERE (display_name LIKE ? OR voice_part LIKE ? OR phone LIKE ? OR id IN (${profileIds.map(() => "?").join(", ")}))
               ${hiddenFilter}
             ORDER BY display_name ASC
             LIMIT ?`,
            likePattern,
            likePattern,
            likePattern,
            ...profileIds,
            limit,
          )
          .toArray()
      : storage.sql
          .exec<ProfileRow>(
            `SELECT id, display_name AS displayName, voice_part AS voicePart, global_status AS globalStatus, hidden
             FROM profiles
             WHERE (display_name LIKE ? OR voice_part LIKE ? OR phone LIKE ?)
               ${hiddenFilter}
             ORDER BY display_name ASC
             LIMIT ?`,
            likePattern,
            likePattern,
            likePattern,
            limit,
          )
          .toArray();

  return rows.map((p) => {
    const status = p.globalStatus ?? "Active";
    const badge = p.hidden === 1 ? `Hidden · ${status}` : status;
    return {
      badge,
      category: "roster",
      href: `/admin/roster?profileId=${p.id}`,
      id: `roster-${p.id}`,
      subtitle: p.voicePart ?? undefined,
      title: p.displayName,
    };
  });
}

function searchEvents(
  storage: SearchStoreStorage,
  likePattern: string,
  limit: number,
): readonly SearchResultItem[] {
  const rows = storage.sql
    .exec<EventRow>(
      `SELECT id, title, type, starts_at AS startsAt, location
       FROM events
       WHERE is_archived = 0 AND (title LIKE ? OR location LIKE ? OR type LIKE ?)
       ORDER BY starts_at DESC
       LIMIT ?`,
      likePattern,
      likePattern,
      likePattern,
      limit,
    )
    .toArray();

  return rows.map((e) => {
    const datePart = e.startsAt ? e.startsAt.slice(0, 10) : "";
    const subtitleParts = [e.type, datePart, e.location].filter(Boolean);
    return {
      badge: e.type,
      category: "events",
      href: `/admin/events?eventId=${e.id}`,
      id: `event-${e.id}`,
      subtitle: subtitleParts.length > 0 ? subtitleParts.join(" • ") : undefined,
      title: e.title,
    };
  });
}

function searchMusicPieces(
  storage: SearchStoreStorage,
  likePattern: string,
  limit: number,
): readonly SearchResultItem[] {
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
      href: `/admin/library?pieceId=${m.id}`,
      id: `music-${m.id}`,
      subtitle: details || undefined,
      title: m.title,
    };
  });
}

function searchPolls(
  storage: SearchStoreStorage,
  likePattern: string,
  limit: number,
): readonly SearchResultItem[] {
  const rows = storage.sql
    .exec<PollRow>(
      `SELECT id, title, expires_at AS expiresAt
       FROM polls
       WHERE archived_at = '' AND title LIKE ?
       ORDER BY created_at DESC
       LIMIT ?`,
      likePattern,
      limit,
    )
    .toArray();

  return rows.map((pol) => {
    const datePart = pol.expiresAt ? pol.expiresAt.slice(0, 10) : "";
    return {
      badge: "Poll",
      category: "polls",
      href: `/admin/polls?pollId=${pol.id}`,
      id: `poll-${pol.id}`,
      subtitle: datePart ? `Expires: ${datePart}` : undefined,
      title: pol.title,
    };
  });
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
  const profileIds = options.profileIds ?? [];
  if (!cleanQuery && profileIds.length === 0) {
    return Response.json({ results: [] });
  }

  const likePattern = `%${cleanQuery}%`;
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
  const results: SearchResultItem[] = [];

  const shouldSearch = (cat: SearchCategory) => !options.category || options.category === cat;

  if (shouldSearch("roster")) {
    results.push(
      ...searchRosterProfiles(
        storage,
        likePattern,
        profileIds,
        limit,
        options.includeHidden ?? false,
      ),
    );
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
