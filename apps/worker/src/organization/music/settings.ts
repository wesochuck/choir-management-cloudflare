import { organizationMusicLibrarySettingsRequestSchema } from "@choir/contracts";
import type { z } from "zod";

import { defaultMusicLibrarySettings, identityMatches } from "./types.js";
import type { musicOperationSchema } from "./types.js";

export function storedMusicLibrarySettings(storage: DurableObjectStorage) {
  try {
    const raw = storage.sql
      .exec<{
        readonly genresJson: string;
        readonly lifetimeDays: number;
        readonly template: string;
      }>(
        `SELECT music_genres_json AS genresJson,
           music_publisher_search_template AS template,
           practice_player_link_lifetime_days AS lifetimeDays
         FROM organization_metadata LIMIT 1`,
      )
      .toArray()
      .at(0);
    return organizationMusicLibrarySettingsRequestSchema.parse({
      genres: raw === undefined ? [] : (JSON.parse(raw.genresJson) as unknown),
      practicePlayerLinkLifetimeDays: raw?.lifetimeDays ?? 180,
      publisherSearchTemplate: raw?.template ?? "",
    });
  } catch {
    return defaultMusicLibrarySettings;
  }
}

export function readMusicLibrarySettingsFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (!organizationId || !identityMatches(storage, organizationId)) {
    return Response.json({ code: "organization_identity_conflict" }, { status: 409 });
  }
  return Response.json(storedMusicLibrarySettings(storage));
}

export function updateMusicLibrarySettings(
  storage: DurableObjectStorage,
  operation: Extract<z.infer<typeof musicOperationSchema>, { readonly action: "update_settings" }>,
): Response {
  const occurredAt = new Date().toISOString();
  storage.transactionSync(() => {
    storage.sql.exec(
      `UPDATE organization_metadata SET music_genres_json = ?,
         music_publisher_search_template = ?,
         practice_player_link_lifetime_days = ?, updated_at = ?`,
      JSON.stringify(operation.settings.genres),
      operation.settings.publisherSearchTemplate,
      operation.settings.practicePlayerLinkLifetimeDays,
      occurredAt,
    );
    storage.sql.exec(
      `INSERT INTO audit_events
        (id, actor_type, actor_id, action, target_type, target_id,
         request_id, change_summary, occurred_at)
       VALUES (?, 'organization_member', ?, 'music.library_settings_updated',
         'organization', ?, ?, ?, ?)`,
      `music:settings:${operation.requestId}`,
      operation.actorUserId,
      operation.organizationId,
      operation.requestId,
      JSON.stringify({
        genres: operation.settings.genres,
        practicePlayerLinkLifetimeDays: operation.settings.practicePlayerLinkLifetimeDays,
        publisherSearchTemplate: operation.settings.publisherSearchTemplate,
      }),
      occurredAt,
    );
  });
  return Response.json(operation.settings);
}
