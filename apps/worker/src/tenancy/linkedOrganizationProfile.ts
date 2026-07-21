interface LinkedProfileRow {
  readonly profileId: string | null;
}

export async function linkedOrganizationProfileId(
  database: D1Database,
  organizationId: string,
  userId: string,
): Promise<string | null> {
  const membership = await database
    .prepare(
      `SELECT profileId FROM member
       WHERE organizationId = ? AND userId = ? LIMIT 1`,
    )
    .bind(organizationId, userId)
    .first<LinkedProfileRow>();
  return membership?.profileId ?? null;
}
