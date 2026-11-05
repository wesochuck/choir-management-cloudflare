import type { DonationPublication, DonationPublicationContext } from "@choir/contracts";
import { formatTimezoneName, rsvpDeadlineFromDate } from "@choir/domain";
import { useEffect, useState } from "react";

function deadlinePassed(date: string | null, timezone: string, now: number) {
  if (!date) return false;
  return now > Date.parse(rsvpDeadlineFromDate(date, timezone)?.deadlineAt ?? "");
}
function recognitionCopy(
  p: DonationPublication,
  context: DonationPublicationContext | null | undefined,
  anonymous: boolean,
  now: number,
) {
  if (anonymous) return "Your name will remain private.";
  if (!p.recognitionDate) return null;
  if (context?.recognitionStatus === "on_time")
    return "Your gift met the name-recognition cutoff for this publication.";
  if (context?.recognitionStatus === "unconfigured") return null;
  const late = context
    ? context.recognitionStatus === "after_cutoff"
    : deadlinePassed(p.recognitionDate, p.timezone, now);
  if (late)
    return `The name-recognition cutoff has passed. Your donation is welcome, but inclusion of your name in ${p.name} is no longer guaranteed.`;
  const deadlineAt = rsvpDeadlineFromDate(p.recognitionDate, p.timezone)?.deadlineAt;
  const tzName = formatTimezoneName(p.timezone, deadlineAt ?? p.recognitionDate);
  return `For name recognition, complete your donation by ${p.recognitionDate} at 11:59 p.m. (${tzName}).`;
}
function artworkCopy(
  p: DonationPublication,
  context: DonationPublicationContext | null | undefined,
  now: number,
) {
  if (!p.artworkDate || context?.artworkStatus === "unconfigured") return null;
  if (context?.artworkStatus === "on_time")
    return "Your artwork was received by the deadline for this publication.";
  const late =
    context?.artworkStatus === "after_cutoff" || deadlinePassed(p.artworkDate, p.timezone, now);
  if (late)
    return `The artwork deadline has passed. You can still submit artwork, but inclusion in ${p.name} is no longer guaranteed.`;
  const deadlineAt = rsvpDeadlineFromDate(p.artworkDate, p.timezone)?.deadlineAt;
  const tzName = formatTimezoneName(p.timezone, deadlineAt ?? p.artworkDate);
  return `Submit program-ad artwork by ${p.artworkDate} at 11:59 p.m. (${tzName}).`;
}
export function PublicationNotice({
  publication,
  context,
  artwork = false,
  anonymous = false,
}: {
  readonly publication?: DonationPublication | null | undefined;
  readonly context?: DonationPublicationContext | null | undefined;
  readonly artwork?: boolean;
  readonly anonymous?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);
  const p = context?.publication ?? publication;
  if (!p) return null;
  const recognition = recognitionCopy(p, context, anonymous, now);
  const art = artwork ? artworkCopy(p, context, now) : null;
  if (!recognition && !art) return null;
  return (
    <div className="notice notice--info" aria-live="polite">
      <strong>{p.name}</strong>
      {recognition ? <p>{recognition}</p> : null}
      {art ? <p>{art}</p> : null}
    </div>
  );
}
