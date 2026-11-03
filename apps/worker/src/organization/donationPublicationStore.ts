import { z } from "zod";
import {
  donationPublicationSchema,
  donationPublicationMutationSchema,
  donationInclusionMutationSchema,
} from "@choir/contracts";
import { compilePublicationDeadline } from "@choir/domain";
import { donationSelect, type DonationRow } from "./donation/types";
import { donationResults } from "./donation/queries";

const revisionSchema = z
  .array(
    z.object({
      effectiveAt: z.iso.datetime(),
      recognitionDate: z.iso.date().nullable(),
      artworkDate: z.iso.date().nullable(),
      timezone: z.string(),
    }),
  )
  .max(500);
function compiledPublication(row: DonationRow) {
  const publication = donationPublicationSchema.parse(JSON.parse(row.publicationJson ?? "null"));
  const revisions = revisionSchema.parse(JSON.parse(row.publicationRevisionsJson ?? "[]"));
  const compile = (field: "recognitionDate" | "artworkDate") =>
    compilePublicationDeadline(
      revisions.map((r) => ({
        effectiveAt: r.effectiveAt,
        timezone: r.timezone,
        deadlineDate: r[field],
      })),
      true,
    );
  const recognition = compile("recognitionDate");
  const artwork = compile("artworkDate");
  const advertised = new Map(
    revisions.map((r, i) => [
      i + 1,
      compilePublicationDeadline([
        {
          effectiveAt: "0001-01-01T00:00:00Z",
          timezone: r.timezone,
          deadlineDate: r.recognitionDate,
        },
      ]),
    ]),
  );
  return (fact: DonationRow) => {
    const paidAt = fact.publicationPaidAt ?? null;
    const atCheckout = advertised.get(fact.publicationCapturedRevision ?? 1)?.(paidAt);
    return {
      publication,
      paidAt,
      recognitionStatus:
        atCheckout === "on_time" || atCheckout === "unconfigured"
          ? atCheckout
          : recognition(paidAt),
      artworkStatus: artwork(fact.artworkUploadedAt),
    };
  };
}
/** A request-scoped policy cache avoids scanning/reconverting history for each row. */
export function createPublicationContextReader() {
  const policies = new Map<string, ReturnType<typeof compiledPublication>>();
  return (row: DonationRow) => {
    if (!row.publicationJson) return null;
    let read = policies.get(row.publicationJson);
    if (!read) {
      read = compiledPublication(row);
      policies.set(row.publicationJson, read);
    }
    return read(row);
  };
}
export function publicationContext(row: DonationRow) {
  return createPublicationContextReader()(row);
}
export function currentDonationPublication(storage: DurableObjectStorage) {
  const row = storage.sql
    .exec<{ json: string }>(
      `SELECT json_object('id',id,'name',name,'recognitionDate',recognition_date,'artworkDate',artwork_date,'timezone',timezone,'revision',revision) AS json FROM donation_publications WHERE current = 1 LIMIT 1`,
    )
    .toArray()[0];
  return row ? donationPublicationSchema.parse(JSON.parse(row.json)) : null;
}
function identity(storage: DurableObjectStorage, organizationId: string) {
  return (
    storage.sql
      .exec<{ organizationId: string }>(
        "SELECT organization_id AS organizationId FROM organization_metadata LIMIT 1",
      )
      .one().organizationId === organizationId
  );
}
function audit(
  storage: DurableObjectStorage,
  input: { actorUserId: string; requestId: string },
  action: string,
  targetId: string,
  summary: unknown,
) {
  storage.sql.exec(
    `INSERT INTO audit_events(id,actor_type,actor_id,action,target_type,target_id,request_id,change_summary,occurred_at) VALUES(?,'organization_member',?,?,'donation_publication',?,?,?,?)`,
    `${action}:${input.requestId}`,
    input.actorUserId,
    action,
    targetId,
    input.requestId,
    JSON.stringify(summary),
    new Date().toISOString(),
  );
}
export function listDonationPublications(
  storage: DurableObjectStorage,
  input: { organizationId: string; before?: string | undefined },
) {
  if (!identity(storage, input.organizationId))
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  const rows = storage.sql
    .exec<{ json: string; id: string }>(
      `SELECT id,json_object('id',id,'name',name,'recognitionDate',recognition_date,'artworkDate',artwork_date,'timezone',timezone,'revision',revision) AS json FROM donation_publications WHERE id > ? ORDER BY id LIMIT 101`,
      input.before ?? "",
    )
    .toArray();
  return Response.json({
    publications: rows
      .slice(0, 100)
      .map((r) => donationPublicationSchema.parse(JSON.parse(r.json))),
    nextCursor: rows.length > 100 ? rows[99]?.id : null,
    current: currentDonationPublication(storage),
  });
}
export function saveDonationPublication(
  storage: DurableObjectStorage,
  input: {
    organizationId: string;
    actorUserId: string;
    mutation: z.infer<typeof donationPublicationMutationSchema>;
  },
) {
  if (!identity(storage, input.organizationId))
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  const m = donationPublicationMutationSchema.parse(input.mutation);
  return storage.transactionSync(() => {
    if (
      storage.sql
        .exec(
          "SELECT id FROM audit_events WHERE id = ? LIMIT 1",
          `donation.publication_saved:${m.requestId}`,
        )
        .toArray().length
    )
      return listDonationPublications(storage, input);
    const existing = storage.sql
      .exec<{ revision: number }>("SELECT revision FROM donation_publications WHERE id = ?", m.id)
      .toArray()[0];
    if ((existing?.revision ?? 0) !== m.expectedRevision || (existing?.revision ?? 0) >= 500)
      return Response.json({ code: "publication_revision_conflict" }, { status: 409 });
    const timezone = storage.sql
      .exec<{ timezone: string }>("SELECT timezone FROM organization_metadata LIMIT 1")
      .one().timezone;
    const now = new Date().toISOString();
    if (!existing)
      storage.sql.exec("UPDATE donation_publications SET current = 0 WHERE current = 1");
    storage.sql.exec(
      `INSERT INTO donation_publications(id,name,current,timezone,revision,recognition_date,artwork_date) VALUES(?,?,1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,timezone=excluded.timezone,revision=excluded.revision,recognition_date=excluded.recognition_date,artwork_date=excluded.artwork_date`,
      m.id,
      m.name,
      timezone,
      m.expectedRevision + 1,
      m.recognitionDate,
      m.artworkDate,
    );
    storage.sql.exec(
      "INSERT INTO donation_publication_revisions(publication_id,revision,effective_at,recognition_date,artwork_date,timezone) VALUES(?,?,?,?,?,?)",
      m.id,
      m.expectedRevision + 1,
      now,
      m.recognitionDate,
      m.artworkDate,
      timezone,
    );
    audit(storage, { ...input, requestId: m.requestId }, "donation.publication_saved", m.id, {
      revision: m.expectedRevision + 1,
    });
    return listDonationPublications(storage, input);
  });
}
export function captureDonationPublication(
  storage: DurableObjectStorage,
  donationId: string,
  publicationId: string | null,
  paidAt: string | null,
) {
  if (publicationId)
    storage.sql.exec(
      "INSERT INTO donation_publication_facts(donation_id,publication_id,paid_at,captured_revision) SELECT ?,id,?,revision FROM donation_publications WHERE id=? ON CONFLICT(donation_id) DO NOTHING",
      donationId,
      paidAt,
      publicationId,
    );
}
export function recordPublicationArtwork(
  storage: DurableObjectStorage,
  donationId: string,
  fileId: string | null,
  at: string,
) {
  if (!fileId) return;
  storage.sql.exec(
    "INSERT INTO donation_artwork_submissions(donation_id,file_id,received_at) VALUES(?,?,?) ON CONFLICT DO NOTHING",
    donationId,
    fileId,
    at,
  );
}
export function setDonationInclusion(
  storage: DurableObjectStorage,
  input: {
    organizationId: string;
    actorUserId: string;
    mutation: z.infer<typeof donationInclusionMutationSchema>;
  },
) {
  if (!identity(storage, input.organizationId))
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  const m = donationInclusionMutationSchema.parse(input.mutation);
  return storage.transactionSync(() => {
    if (
      storage.sql
        .exec(
          "SELECT id FROM audit_events WHERE id=? LIMIT 1",
          `donation.publication_inclusion:${m.requestId}`,
        )
        .toArray().length
    )
      return Response.json({ success: true });
    const donation = storage.sql
      .exec<{ status: string; artworkFileId: string | null }>(
        "SELECT status,artwork_file_id AS artworkFileId FROM donations WHERE id=?",
        m.donationId,
      )
      .toArray()[0];
    if (!donation) return Response.json({ code: "donation_not_found" }, { status: 404 });
    if (m.publicationId && donation.status !== "paid")
      return Response.json({ code: "paid_donation_required" }, { status: 409 });
    if (
      m.publicationId &&
      !storage.sql
        .exec("SELECT id FROM donation_publications WHERE id=?", m.publicationId)
        .toArray().length
    )
      return Response.json({ code: "publication_not_found" }, { status: 404 });
    const old = storage.sql
      .exec<{ revision: number }>(
        "SELECT revision FROM donation_publication_inclusions WHERE donation_id=?",
        m.donationId,
      )
      .toArray()[0];
    if ((old?.revision ?? 0) !== m.expectedRevision)
      return Response.json({ code: "inclusion_revision_conflict" }, { status: 409 });
    storage.sql.exec(
      `INSERT INTO donation_publication_inclusions(donation_id,publication_id,revision,artwork_file_id,recorded_at,actor_id) VALUES(?,?,?,?,?,?) ON CONFLICT(donation_id) DO UPDATE SET publication_id=excluded.publication_id,revision=excluded.revision,artwork_file_id=excluded.artwork_file_id,recorded_at=excluded.recorded_at,actor_id=excluded.actor_id`,
      m.donationId,
      m.publicationId,
      m.expectedRevision + 1,
      donation.artworkFileId,
      new Date().toISOString(),
      input.actorUserId,
    );
    audit(
      storage,
      { ...input, requestId: m.requestId },
      "donation.publication_inclusion",
      m.donationId,
      { publicationId: m.publicationId },
    );
    return Response.json({ success: true });
  });
}
export function reviewDonationPublications(
  storage: DurableObjectStorage,
  input: {
    organizationId: string;
    cursor?: string | undefined;
    publicationId?: string | undefined;
    filter?: string | undefined;
  },
) {
  if (!identity(storage, input.organizationId))
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  // Scan one indexed ID page, not the newest-500 financial endpoint. Filtering is bounded;
  // an empty filtered page may still have a continuation cursor.
  const rows = storage.sql
    .exec<DonationRow>(
      `${donationSelect} WHERE d.id > ? ${input.publicationId ? "AND d.id IN (SELECT donation_id FROM donation_publication_facts WHERE publication_id=?)" : ""} ORDER BY d.id LIMIT 101`,
      input.cursor ?? "",
      ...(input.publicationId ? [input.publicationId] : []),
    )
    .toArray();
  const donations = donationResults(rows.slice(0, 100)).filter((d) => {
    const context = d.publicationContext;
    if (input.filter === "late_gift") return context?.recognitionStatus === "after_cutoff";
    if (input.filter === "late_artwork") return context?.artworkStatus === "after_cutoff";
    if (input.filter === "review")
      return (
        d.status === "paid" &&
        (!d.includedPublicationId || d.includedArtworkFileId !== d.artworkFileId) &&
        (context?.recognitionStatus === "after_cutoff" || context?.artworkStatus === "after_cutoff")
      );
    return true;
  });
  return Response.json({ donations, nextCursor: rows.length > 100 ? rows[99]?.id : null });
}
