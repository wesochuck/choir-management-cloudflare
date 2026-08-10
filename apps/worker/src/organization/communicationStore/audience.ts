import type { communicationAudienceRequestSchema } from "@choir/contracts";
import type { z } from "zod";

import { audienceOperationSchema, type CandidateRow } from "./contracts";
import { allowedVoiceParts, identityMatches, trackOnlyVoiceParts } from "./shared";

interface CommerceCandidateRow {
  readonly [column: string]: SqlStorageValue;
  readonly buyerEmail: string;
  readonly buyerName: string;
  readonly id: string;
  readonly phone: string;
}

function commerceRecipients(
  storage: DurableObjectStorage,
  audience: z.infer<typeof communicationAudienceRequestSchema>,
): readonly {
  readonly displayName: string;
  readonly doNotEmail: boolean;
  readonly email: string;
  readonly emailSuppressed: boolean;
  readonly phone: string;
  readonly profileId: string;
  readonly voicePart: string;
}[] {
  const recipients: {
    readonly displayName: string;
    readonly doNotEmail: boolean;
    readonly email: string;
    readonly emailSuppressed: boolean;
    readonly phone: string;
    readonly profileId: string;
    readonly voicePart: string;
  }[] = [];
  const seenEmails = new Set<string>();
  const add = (row: CommerceCandidateRow, voicePart: "Donor" | "Ticket Buyer") => {
    const email = row.buyerEmail.trim().toLowerCase();
    if (!email || seenEmails.has(email)) return;
    seenEmails.add(email);
    recipients.push({
      displayName: row.buyerName,
      doNotEmail: false,
      email: row.buyerEmail,
      emailSuppressed: false,
      phone: row.phone,
      profileId: row.id,
      voicePart,
    });
  };

  if (audience.targetAudiences.includes("Ticket Buyers")) {
    const ticketRows = storage.sql
      .exec<CommerceCandidateRow>(
        `SELECT p.id, p.buyer_name AS buyerName, p.buyer_email AS buyerEmail, '' AS phone
         FROM ticket_purchases p
         WHERE p.status = 'paid'
           AND (
             (? <> '' AND (p.event_id = ? OR p.id IN (
               SELECT purchase_id FROM ticket_bundle_allocations WHERE event_id = ?
             )))
             OR (? = '' AND p.marketing_opt_in = 1)
           )
         ORDER BY p.buyer_name COLLATE NOCASE, p.id LIMIT 500`,
        audience.eventId ?? "",
        audience.eventId ?? "",
        audience.eventId ?? "",
        audience.eventId ?? "",
      )
      .toArray();
    ticketRows.forEach((row) => {
      add(row, "Ticket Buyer");
    });
  }

  if (audience.targetAudiences.includes("Donors")) {
    const donorRows = storage.sql
      .exec<CommerceCandidateRow>(
        `SELECT d.id, d.buyer_name AS buyerName, d.buyer_email AS buyerEmail, '' AS phone
         FROM donations d
         WHERE d.status = 'paid' AND d.marketing_consent = 1
         ORDER BY d.buyer_name COLLATE NOCASE, d.id LIMIT 500`,
      )
      .toArray();
    donorRows.forEach((row) => {
      add(row, "Donor");
    });
  }

  return recipients;
}

export async function resolveCommunicationAudienceFromStore(
  storage: DurableObjectStorage,
  request: Request,
): Promise<Response> {
  const parsed = audienceOperationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ code: "invalid_communication_audience" }, { status: 400 });
  const { audience, organizationId } = parsed.data;
  if (!identityMatches(storage, organizationId))
    return Response.json({ code: "organization_not_found" }, { status: 404 });
  const rows = audience.targetAudiences.includes("Members")
    ? storage.sql
        .exec<CandidateRow>(
          `SELECT p.id, p.display_name AS displayName, NULL AS email, p.phone,
              p.voice_part AS voicePart, p.global_status AS globalStatus, p.do_not_email AS doNotEmail,
              EXISTS (
                SELECT 1 FROM communication_suppressions s
                WHERE s.profile_id = p.id AND s.channel = 'email' AND s.active = 1
              ) AS emailSuppressed,
              COALESCE(r.rsvp, 'Pending') AS rsvp
             FROM profiles p
             LEFT JOIN event_rosters r ON r.profile_id = p.id AND r.event_id = ?
             ORDER BY p.display_name COLLATE NOCASE, p.id LIMIT 500`,
          audience.eventId ?? "",
        )
        .toArray()
    : [];
  const requestedProfiles = audience.profileIds.length > 0 ? new Set(audience.profileIds) : null;
  const requestedVoiceParts = allowedVoiceParts(storage, audience.voiceParts);
  const excludedVoiceParts = trackOnlyVoiceParts(storage);
  const statuses = new Set(audience.globalStatuses);
  const recipients: {
    readonly displayName: string;
    readonly doNotEmail: boolean;
    readonly email: string;
    readonly emailSuppressed: boolean;
    readonly phone: string;
    readonly profileId: string;
    readonly voicePart: string;
  }[] = rows
    .filter(({ id }) => !requestedProfiles || requestedProfiles.has(id))
    .filter(({ globalStatus }) => statuses.has(globalStatus))
    .filter(({ voicePart }) => voicePart.length > 0 && !excludedVoiceParts.has(voicePart))
    .filter(({ voicePart }) => !requestedVoiceParts || requestedVoiceParts.has(voicePart))
    .filter(({ rsvp }) => !audience.eventId || audience.rsvp === "All" || audience.rsvp === rsvp)
    .map(({ displayName, doNotEmail, email, emailSuppressed, id, phone, voicePart }) => ({
      displayName,
      doNotEmail: doNotEmail === 1,
      email,
      emailSuppressed: emailSuppressed === 1,
      phone,
      profileId: id,
      voicePart,
    }));
  recipients.push(...commerceRecipients(storage, audience));
  return Response.json({ recipients });
}
