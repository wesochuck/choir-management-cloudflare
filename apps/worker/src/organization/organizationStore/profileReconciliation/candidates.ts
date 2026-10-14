import type { SqlStorageValue } from "@cloudflare/workers-types";
import type { ProfileReconciliationCandidate } from "@choir/contracts";

import type { ProfileReconciliationStoreStorage, RawProfileRow } from "./shared";

export function computeCandidateMatchReasons(
  candidate: RawProfileRow,
  sourceNameNormalized: string,
  sourcePartNormalized: string,
  sourcePhoneNormalized: string,
  queryNormalized: string,
): readonly string[] {
  const candidateName = candidate.display_name.trim().toLowerCase();
  const candidatePart = candidate.voice_part.trim().toLowerCase();
  const candidatePhone = candidate.phone.replace(/\D/g, "");

  const matchReasons: string[] = [];
  if (candidateName === sourceNameNormalized) {
    matchReasons.push("Exact name match");
  } else if (
    candidateName.includes(sourceNameNormalized) ||
    sourceNameNormalized.includes(candidateName)
  ) {
    matchReasons.push("Similar name");
  }

  if (sourcePartNormalized && candidatePart === sourcePartNormalized) {
    matchReasons.push("Matching voice part");
  }

  if (sourcePhoneNormalized && candidatePhone && candidatePhone === sourcePhoneNormalized) {
    matchReasons.push("Matching phone");
  }

  if (queryNormalized && candidateName.includes(queryNormalized)) {
    matchReasons.push("Search match");
  }

  return matchReasons;
}

export function findReconciliationCandidatesInStore(
  storage: ProfileReconciliationStoreStorage,
  input: {
    readonly query?: string | undefined;
    readonly sourceProfileId: string;
  },
): readonly ProfileReconciliationCandidate[] {
  const sourceRows = storage.sql
    .exec<RawProfileRow>("SELECT * FROM profiles WHERE id = ? LIMIT 1", input.sourceProfileId)
    .toArray();
  const source = sourceRows[0];
  if (!source) return [];

  const candidates = storage.sql
    .exec<RawProfileRow>(
      `SELECT * FROM profiles
       WHERE id <> ? AND merged_into_profile_id IS NULL AND hidden = 0
       ORDER BY display_name COLLATE NOCASE ASC LIMIT 100`,
      source.id,
    )
    .toArray();

  const sourceNameNormalized = source.display_name.trim().toLowerCase();
  const sourcePartNormalized = source.voice_part.trim().toLowerCase();
  const sourcePhoneNormalized = source.phone.replace(/\D/g, "");
  const queryNormalized = input.query?.trim().toLowerCase() ?? "";

  const results: ProfileReconciliationCandidate[] = [];

  for (const candidate of candidates) {
    const matchReasons = computeCandidateMatchReasons(
      candidate,
      sourceNameNormalized,
      sourcePartNormalized,
      sourcePhoneNormalized,
      queryNormalized,
    );

    if (matchReasons.length > 0) {
      results.push({
        displayName: candidate.display_name,
        globalStatus: candidate.global_status,
        id: candidate.id,
        matchReasons: [...matchReasons],
        phone: candidate.phone,
        voicePart: candidate.voice_part,
      });
    }
  }

  return results;
}

export function resolveCanonicalProfileId(
  storage: ProfileReconciliationStoreStorage,
  profileId: string,
): string {
  let currentId = profileId;
  const visited = new Set<string>();

  for (let hop = 0; hop < 10; hop++) {
    if (visited.has(currentId)) {
      break;
    }
    visited.add(currentId);

    const row = storage.sql
      .exec<{
        readonly [column: string]: SqlStorageValue;
        readonly merged_into_profile_id: string | null;
      }>("SELECT merged_into_profile_id FROM profiles WHERE id = ? LIMIT 1", currentId)
      .toArray()
      .at(0);

    if (row?.merged_into_profile_id) {
      currentId = row.merged_into_profile_id;
    } else {
      break;
    }
  }

  return currentId;
}
