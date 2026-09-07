import { normalizeEmail, normalizePhone } from "./contacts";

export type CommunicationRecipientSubjectKind =
  "profile" | "contact" | "ticket_purchase" | "donation";

/**
 * One audience candidate before destination dedupe.
 *
 * Each selected audience (Members, Contacts, Ticket Buyers, Donors) is built
 * independently into candidates; `dedupeCommunicationCandidates` then merges
 * them by normalized destination. New candidates use `profile` (Members) or
 * `contact` (Contacts, Ticket Buyers, Donors) subjects; the commerce kinds
 * remain in the union so historical deliveries still merge and display.
 * Suppression and explicit unsubscribe flags are carried per channel so that
 * a block from any identity wins over eligibility from another
 * (Scenarios D/E/F).
 */
export interface CommunicationRecipientCandidate {
  readonly displayName: string;
  readonly doNotEmail: boolean;
  readonly email: string | null;
  readonly emailSuppressed: boolean;
  readonly emailUnsubscribed: boolean;
  /** True when the provider reported a hard bounce / suppression for email. */
  readonly providerBounced: boolean;
  readonly phone: string | null;
  readonly smsSuppressed: boolean;
  readonly smsUnsubscribed: boolean;
  readonly subjectId: string;
  readonly subjectKind: CommunicationRecipientSubjectKind;
}

export interface ResolvedCommunicationRecipient {
  readonly displayName: string;
  readonly email: string;
  readonly emailBlocked: boolean;
  readonly phone: string;
  readonly smsBlocked: boolean;
  readonly subjectId: string;
  readonly subjectKind: CommunicationRecipientSubjectKind;
}

/** Preference order when several identities share one destination. */
const SUBJECT_PRECEDENCE: Readonly<Record<CommunicationRecipientSubjectKind, number>> = {
  contact: 1,
  donation: 2,
  profile: 0,
  ticket_purchase: 2,
};

function emailKey(value: string | null): string | null {
  const input: string | null | undefined = value;
  const normalized = normalizeEmail(input);
  if (normalized === null || normalized.length === 0) return null;
  // Reject malformed destinations so they never become deliveries.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return `email:${normalized}`;
}

function smsKey(value: string | null): string | null {
  if (value === null) return null;
  const normalized = normalizePhone(value);
  return normalized === null ? null : `sms:${normalized}`;
}

function emailBlocked(candidate: CommunicationRecipientCandidate): boolean {
  return (
    candidate.doNotEmail ||
    candidate.emailSuppressed ||
    candidate.emailUnsubscribed ||
    candidate.providerBounced
  );
}

function smsBlocked(candidate: CommunicationRecipientCandidate): boolean {
  return candidate.smsSuppressed || candidate.smsUnsubscribed;
}

function preferCandidate(
  current: CommunicationRecipientCandidate,
  next: CommunicationRecipientCandidate,
): CommunicationRecipientCandidate {
  return SUBJECT_PRECEDENCE[next.subjectKind] < SUBJECT_PRECEDENCE[current.subjectKind]
    ? next
    : current;
}

interface EmailEntry {
  blocked: boolean;
  displayName: string;
  email: string;
  representative: CommunicationRecipientCandidate;
}

interface SmsEntry {
  blocked: boolean;
  displayName: string;
  phone: string;
  representative: CommunicationRecipientCandidate;
}

interface Draft {
  displayName: string;
  email: string;
  emailBlocked: boolean;
  phone: string;
  smsBlocked: boolean;
  subjectId: string;
  subjectKind: CommunicationRecipientSubjectKind;
}

function accumulateEmailEntries(
  candidates: readonly CommunicationRecipientCandidate[],
): ReadonlyMap<string, EmailEntry> {
  const emails = new Map<string, EmailEntry>();
  for (const candidate of candidates) {
    const destination = emailKey(candidate.email);
    if (destination === null) continue;
    const existing = emails.get(destination);
    if (!existing) {
      emails.set(destination, {
        blocked: emailBlocked(candidate),
        displayName: candidate.displayName,
        email: destination.slice("email:".length),
        representative: candidate,
      });
    } else {
      existing.blocked = existing.blocked || emailBlocked(candidate);
      existing.representative = preferCandidate(existing.representative, candidate);
      existing.displayName = existing.representative.displayName;
    }
  }
  return emails;
}

function accumulatePhoneEntries(
  candidates: readonly CommunicationRecipientCandidate[],
): ReadonlyMap<string, SmsEntry> {
  const phones = new Map<string, SmsEntry>();
  for (const candidate of candidates) {
    const destination = smsKey(candidate.phone);
    if (destination === null) continue;
    const existing = phones.get(destination);
    if (!existing) {
      phones.set(destination, {
        blocked: smsBlocked(candidate),
        displayName: candidate.displayName,
        phone: destination.slice("sms:".length),
        representative: candidate,
      });
    } else {
      existing.blocked = existing.blocked || smsBlocked(candidate);
      existing.representative = preferCandidate(existing.representative, candidate);
      existing.displayName = existing.representative.displayName;
    }
  }
  return phones;
}

function mergeEmailEntry(drafts: Map<string, Draft>, entry: EmailEntry): void {
  const { representative } = entry;
  const key = `${representative.subjectKind}:${representative.subjectId}`;
  const draft = drafts.get(key);
  if (!draft) {
    drafts.set(key, {
      displayName: entry.displayName,
      email: entry.blocked ? "" : entry.email,
      emailBlocked: entry.blocked,
      phone: "",
      smsBlocked: false,
      subjectId: representative.subjectId,
      subjectKind: representative.subjectKind,
    });
    return;
  }
  draft.emailBlocked = draft.emailBlocked || entry.blocked;
  if (!entry.blocked && draft.email === "") {
    draft.email = entry.email;
    draft.displayName = entry.displayName;
  }
}

function mergePhoneEntry(drafts: Map<string, Draft>, entry: SmsEntry): void {
  const { representative } = entry;
  const key = `${representative.subjectKind}:${representative.subjectId}`;
  const draft = drafts.get(key);
  if (!draft) {
    drafts.set(key, {
      displayName: entry.displayName,
      email: "",
      emailBlocked: false,
      phone: entry.blocked ? "" : entry.phone,
      smsBlocked: entry.blocked,
      subjectId: representative.subjectId,
      subjectKind: representative.subjectKind,
    });
    return;
  }
  draft.smsBlocked = draft.smsBlocked || entry.blocked;
  if (!entry.blocked && draft.phone === "") {
    draft.phone = entry.phone;
    if (draft.displayName === "") draft.displayName = entry.displayName;
  }
}

/**
 * Merges independently built audience candidates into one recipient per
 * normalized destination, per channel.
 *
 * Rules:
 * - email destinations merge on `email:<normalized-email>`;
 *   SMS destinations merge on `sms:<normalized-phone>`;
 * - an active unsubscribe/suppression (or explicit unsubscribed, or provider
 *   bounce for email) from any identity blocks that destination, regardless
 *   of which audience caused the selection;
 * - duplicate membership never yields duplicate delivery;
 * - same display name with different destinations stays separate;
 * - missing/invalid destinations are dropped, never delivered.
 *
 * Lookup is Map-based; no linear scans run inside the merge loops.
 */
export function dedupeCommunicationCandidates(
  candidates: readonly CommunicationRecipientCandidate[],
): readonly ResolvedCommunicationRecipient[] {
  const drafts = new Map<string, Draft>();
  for (const entry of accumulateEmailEntries(candidates).values()) {
    mergeEmailEntry(drafts, entry);
  }
  for (const entry of accumulatePhoneEntries(candidates).values()) {
    mergePhoneEntry(drafts, entry);
  }
  const resolved: ResolvedCommunicationRecipient[] = [];
  for (const draft of drafts.values()) {
    // Recipients blocked on every selected channel keep empty destinations so
    // reach previews count them as unreachable while sends create no
    // deliveries for them. Never drop them here: dropping would hide
    // suppression from audience previews.
    resolved.push({ ...draft });
  }
  return resolved;
}
