import { z } from "zod";

import { duesSelect, seasonSelect } from "./contracts";
import type { DuesRow, SeasonRow } from "./contracts";
import { duesResult } from "./payments";
import { identity, seasonResult } from "./shared";

export function listSeasonsFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (identity(storage)?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  return Response.json({
    seasons: storage.sql
      .exec<SeasonRow>(`${seasonSelect} ORDER BY s.created_at DESC, s.id DESC LIMIT 500`)
      .toArray()
      .map(seasonResult),
  });
}

export function listDuesFromStore(
  storage: DurableObjectStorage,
  organizationId: string | null,
): Response {
  if (identity(storage)?.organizationId !== organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  return Response.json({
    dues: storage.sql
      .exec<DuesRow>(`${duesSelect} ORDER BY d.created_at DESC, d.id DESC LIMIT 500`)
      .toArray()
      .map(duesResult),
  });
}

export function readMemberActiveSeasonFromStore(
  storage: DurableObjectStorage,
  input: { readonly organizationId: string | null; readonly profileId: string | null },
): Response {
  if (identity(storage)?.organizationId !== input.organizationId) {
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  }
  const profileId = z.uuid().safeParse(input.profileId);
  if (!profileId.success) return Response.json({ code: "profile_not_found" }, { status: 404 });
  const season = storage.sql
    .exec<SeasonRow>(`${seasonSelect} WHERE s.is_active = 1 LIMIT 1`)
    .toArray()
    .at(0);
  if (!season) return Response.json({ activeSeason: null });
  const dues = storage.sql
    .exec<DuesRow>(
      `${duesSelect} WHERE d.season_id = ? AND d.profile_id = ? ORDER BY d.updated_at DESC LIMIT 1`,
      season.id,
      profileId.data,
    )
    .toArray()
    .at(0);
  return Response.json({
    activeSeason: {
      duesStatus: dues ? duesResult(dues).status : null,
      season: seasonResult(season),
    },
  });
}
