import { rsvpDeadlineFromDate } from "./statusAutomation";

export type PublicationSubmissionStatus = "unconfigured" | "pending" | "on_time" | "after_cutoff";
export interface PublicationDeadlineRevision {
  readonly effectiveAt: string;
  readonly deadlineDate: string | null;
  readonly timezone: string;
}
function policy(revision: PublicationDeadlineRevision) {
  const effective = Date.parse(revision.effectiveAt);
  if (!Number.isFinite(effective)) throw new Error("Invalid publication policy timestamp.");
  const deadline = revision.deadlineDate
    ? rsvpDeadlineFromDate(revision.deadlineDate, revision.timezone)
    : null;
  if (revision.deadlineDate && !deadline) throw new Error("Invalid publication deadline.");
  return { effective, boundary: deadline ? Date.parse(deadline.deadlineAt) : null };
}
/** Compile once per publication/category; each subsequent fact uses binary search. */
export function compilePublicationDeadline(
  revisions: readonly PublicationDeadlineRevision[],
  includePreHistory = false,
) {
  const policies = revisions.map(policy).sort((a, b) => a.effective - b.effective);
  const later: (number | null)[] = new Array<number | null>(policies.length + 1).fill(-Infinity);
  for (let i = policies.length - 1; i >= 0; i--) {
    const current = policies[i];
    if (!current) continue;
    const next = later[i + 1];
    later[i] =
      current.boundary === null || next === null
        ? null
        : Math.max(current.boundary, next ?? -Infinity);
  }
  const hasDeadline = policies.some((p) => p.boundary !== null);
  return (receivedAt: string | null): PublicationSubmissionStatus => {
    if (!receivedAt) return hasDeadline ? "pending" : "unconfigured";
    const received = Date.parse(receivedAt);
    if (!Number.isFinite(received)) throw new Error("Invalid publication submission timestamp.");
    let low = 0,
      high = policies.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = policies[mid];
      if (candidate && candidate.effective <= received) low = mid + 1;
      else high = mid;
    }
    const index = includePreHistory ? Math.max(0, low - 1) : low - 1;
    const applicable = policies[index];
    if (!applicable) return "unconfigured";
    const boundary = applicable.boundary;
    if (boundary === null) return "unconfigured";
    if (received <= boundary) return "on_time";
    const extension = later[index + 1];
    if (extension === null) return "unconfigured";
    return received <= (extension ?? -Infinity) ? "on_time" : "after_cutoff";
  };
}
/** Later extensions can improve eligibility; later shortenings cannot remove it. */
export function publicationSubmissionStatus(
  receivedAt: string | null,
  revisions: readonly PublicationDeadlineRevision[],
): PublicationSubmissionStatus {
  return compilePublicationDeadline(revisions)(receivedAt);
}
