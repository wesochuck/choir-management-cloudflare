import type { DurableObjectStorage } from "@cloudflare/workers-types";

function readSlotsForAudition(
  storage: DurableObjectStorage,
  auditionId: string,
): { id: string; startsAt: string; endsAt: string }[] {
  return storage.sql
    .exec<{ id: string; startsAt: string; endsAt: string }>(
      `SELECT id, starts_at AS startsAt, ends_at AS endsAt
       FROM audition_slots WHERE audition_id = ? ORDER BY starts_at`,
      auditionId,
    )
    .toArray();
}

export function createAuditionInStore(
  storage: DurableObjectStorage,
  name: string,
  email: string,
  phone: string,
  voicePart: string,
  experience: string,
  availabilityNotes: string,
): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  storage.sql.exec(
    `INSERT INTO auditions (id, name, email, phone, voice_part, experience, availability_notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    name,
    email,
    phone,
    voicePart,
    experience,
    availabilityNotes,
    now,
    now,
  );
  return id;
}

export function readAuditionFromStore(
  storage: DurableObjectStorage,
  _organizationId: string | null,
  auditionId: string,
): Response {
  const row = storage.sql
    .exec<{
      id: string;
      name: string;
      email: string;
      phone: string;
      voicePart: string;
      experience: string;
      availabilityNotes: string;
      status: string;
      createdAt: string;
    }>(
      `SELECT id, name, email, phone, voice_part AS voicePart, experience,
              availability_notes AS availabilityNotes, status,
              created_at AS createdAt
       FROM auditions WHERE id = ? LIMIT 1`,
      auditionId,
    )
    .toArray()
    .at(0);
  if (!row) {
    return Response.json({ code: "audition_not_found" }, { status: 404 });
  }
  const slots = readSlotsForAudition(storage, auditionId);
  return Response.json({
    id: row.id,
    createdAt: row.createdAt,
    email: row.email,
    name: row.name,
    phone: row.phone || undefined,
    voicePart: row.voicePart || undefined,
    experience: row.experience || undefined,
    availabilityNotes: row.availabilityNotes || undefined,
    status: row.status,
    slots,
  });
}

export function listAuditionsFromStore(storage: DurableObjectStorage): Response {
  const rows = storage.sql
    .exec<{
      id: string;
      name: string;
      email: string;
      voicePart: string;
      status: string;
      createdAt: string;
      updatedAt: string;
    }>(
      `SELECT id, name, email, voice_part AS voicePart,
              status, created_at AS createdAt, updated_at AS updatedAt
       FROM auditions ORDER BY created_at DESC`,
    )
    .toArray();
  const auditions = rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    voicePart: row.voicePart || undefined,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    slots: readSlotsForAudition(storage, row.id),
  }));
  return Response.json({ auditions });
}

export function updateAuditionInStore(
  storage: DurableObjectStorage,
  auditionId: string,
  adminNotes: string | undefined,
  status: string | undefined,
): Response {
  const now = new Date().toISOString();
  const updates: string[] = ["updated_at = ?"];
  const params: unknown[] = [now];
  if (adminNotes !== undefined) {
    updates.push("admin_notes = ?");
    params.push(adminNotes);
  }
  if (status !== undefined) {
    updates.push("status = ?");
    params.push(status);
  }
  params.push(auditionId);
  storage.sql.exec(`UPDATE auditions SET ${updates.join(", ")} WHERE id = ?`, ...params);
  return readAuditionFromStore(storage, null, auditionId);
}

export function updateAuditionCandidateInStore(
  storage: DurableObjectStorage,
  auditionId: string,
  availabilityNotes: string | undefined,
  voicePart: string | undefined,
): Response {
  const now = new Date().toISOString();
  const updates: string[] = ["updated_at = ?"];
  const params: unknown[] = [now];
  if (availabilityNotes !== undefined) {
    updates.push("availability_notes = ?");
    params.push(availabilityNotes);
  }
  if (voicePart !== undefined) {
    updates.push("voice_part = ?");
    params.push(voicePart);
  }
  if (updates.length === 1) {
    return readAuditionFromStore(storage, null, auditionId);
  }
  params.push(auditionId);
  storage.sql.exec(`UPDATE auditions SET ${updates.join(", ")} WHERE id = ?`, ...params);
  return readAuditionFromStore(storage, null, auditionId);
}
