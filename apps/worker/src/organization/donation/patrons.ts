export function findOrCreatePatron(
  storage: DurableObjectStorage,
  name: string,
  email: string,
  occurredAt: string,
): string {
  const lowerEmail = email.toLowerCase();
  const existing = storage.sql
    .exec<{ readonly [column: string]: SqlStorageValue; readonly id: string }>(
      "SELECT id FROM patrons WHERE email = ? LIMIT 1",
      lowerEmail,
    )
    .toArray()
    .at(0);
  if (existing) return existing.id;
  const patronId = crypto.randomUUID();
  storage.sql.exec(
    `INSERT INTO patrons (id, name, email, total_donated_cents, donation_count,
      first_donated_at, last_donated_at, created_at, updated_at)
     VALUES (?, ?, ?, 0, 0, ?, ?, ?, ?)`,
    patronId,
    name,
    lowerEmail,
    occurredAt,
    occurredAt,
    occurredAt,
    occurredAt,
  );
  return patronId;
}

export function upsertPatronAfterDonation(
  storage: DurableObjectStorage,
  patronId: string,
  amountCents: number,
  occurredAt: string,
): void {
  storage.sql.exec(
    `UPDATE patrons SET
      total_donated_cents = total_donated_cents + ?,
      donation_count = donation_count + 1,
      last_donated_at = ?,
      updated_at = ?
     WHERE id = ?`,
    amountCents,
    occurredAt,
    occurredAt,
    patronId,
  );
}
