import type { ContactCommunicationStatus } from "@choir/contracts";
import { deriveDisplayName } from "@choir/domain";
import { Dialog, DialogClose } from "@choir/ui";

import type { ContactDetail } from "../api";

function channelStatus(
  detail: ContactDetail,
  channel: "email" | "sms",
): ContactCommunicationStatus {
  return (
    detail.preferences.find((preference) => preference.channel === channel)?.status ?? "unknown"
  );
}

function statusLabel(status: ContactCommunicationStatus): string {
  if (status === "subscribed") return "Subscribed";
  if (status === "unsubscribed") return "Unsubscribed";
  return "Unknown";
}

function lastEmailLabel(lastEmailAt: string | null): string {
  if (!lastEmailAt) return "No marketing email sent yet";
  return new Date(lastEmailAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Phase 10 unified Contact detail view (read-only).
 *
 * The Contact is presented as the relationship and communication identity:
 * its linked roster Profile, list membership, linked commerce activity as
 * counts, and communication status with the last sent email. Ticket,
 * donation, roster, and delivery records stay in their own managers; this
 * dialog projects them without duplicating their data.
 */
export function ContactDetailDialog({
  detail,
  onClose,
  open,
}: {
  readonly detail: ContactDetail;
  readonly onClose: () => void;
  readonly open: boolean;
}) {
  const name = deriveDisplayName({
    displayName: detail.contact.displayName,
    email: detail.contact.email,
    firstName: detail.contact.firstName,
    lastName: detail.contact.lastName,
    phone: detail.contact.phone,
  });
  return (
    <Dialog
      description={`Relationship and activity for ${name}. Contacts never appear on the roster.`}
      dirty={false}
      onClose={onClose}
      open={open}
      title={name || "Contact details"}
    >
      <ContactDetailContent detail={detail} />
      <div className="dialog__actions">
        <DialogClose asChild>
          <button className="button button--secondary" type="button">
            Close
          </button>
        </DialogClose>
      </div>
    </Dialog>
  );
}
/**
 * Pure detail content (no Dialog wrapper) so labels, relationships, counts,
 * and statuses stay covered by server-rendered tests; Radix portals render
 * nothing to a string.
 */
export function ContactDetailContent({ detail }: { readonly detail: ContactDetail }) {
  const listNames = detail.lists
    .map((list) => list.name)
    .toSorted((left, right) => left.localeCompare(right));
  return (
    <div className="contact-detail">
      <section aria-labelledby="contact-detail-profile-heading">
        <h3 id="contact-detail-profile-heading">Organization Profile</h3>
        {detail.linkedProfile ? (
          <p>{detail.linkedProfile.displayName}</p>
        ) : (
          <p>Not linked to a roster profile.</p>
        )}
      </section>
      <section aria-labelledby="contact-detail-lists-heading">
        <h3 id="contact-detail-lists-heading">Lists</h3>
        {listNames.length > 0 ? (
          <ul>
            {listNames.map((listName) => (
              <li key={listName}>{listName}</li>
            ))}
          </ul>
        ) : (
          <p>No lists</p>
        )}
      </section>
      <section aria-labelledby="contact-detail-activity-heading">
        <h3 id="contact-detail-activity-heading">Activity</h3>
        <dl>
          <div>
            <dt>Ticket purchases</dt>
            <dd>{detail.activity.ticketPurchaseCount}</dd>
          </div>
          <div>
            <dt>Donations</dt>
            <dd>{detail.activity.donationCount}</dd>
          </div>
        </dl>
      </section>
      <section aria-labelledby="contact-detail-communication-heading">
        <h3 id="contact-detail-communication-heading">Communication</h3>
        <dl>
          <div>
            <dt>Email</dt>
            <dd>{statusLabel(channelStatus(detail, "email"))}</dd>
          </div>
          <div>
            <dt>SMS</dt>
            <dd>{statusLabel(channelStatus(detail, "sms"))}</dd>
          </div>
          <div>
            <dt>Last email sent</dt>
            <dd>{lastEmailLabel(detail.lastEmailAt)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
