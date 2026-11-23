import type {
  ContactCommunicationPreference,
  ContactCommunicationStatus,
  ContactDetailTicketPurchase,
} from "@choir/contracts";
import { deriveDisplayName } from "@choir/domain";
import { Dialog, DialogClose, Tabs, TabsContent, TabsList, TabsTrigger } from "@choir/ui";
import { useState } from "react";

import type { ContactDetail } from "../api";

type ContactDetailTab = "overview" | "activity" | "lists";

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function initialsForName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase() || "?";
}

function findPreference(
  detail: ContactDetail,
  channel: "email" | "sms",
): ContactCommunicationPreference | undefined {
  return detail.preferences.find((preference) => preference.channel === channel);
}

function channelStatus(
  detail: ContactDetail,
  channel: "email" | "sms",
): ContactCommunicationStatus {
  return findPreference(detail, channel)?.status ?? "unknown";
}

function isTicketPurchaseSource(source: string | null | undefined): boolean {
  if (!source) return false;
  return /ticket/i.test(source);
}

function formatContactSourceLabel(source: string | null | undefined): string {
  if (!source || source.trim() === "") return "Added manually";
  const normalized = source.trim().toLowerCase();
  if (normalized === "ticket_purchase" || normalized === "ticket_checkout") {
    return "Added via ticket purchase";
  }
  if (normalized === "donation" || normalized === "donation_checkout") {
    return "Added via donation";
  }
  if (normalized === "csv_import" || normalized === "import") {
    return "Added via CSV import";
  }
  if (normalized === "manual") return "Added manually";
  return `Source: ${source.trim()}`;
}

function purchaseItemTitle(purchase: ContactDetailTicketPurchase): string {
  return purchase.bundleId !== null
    ? purchase.bundleTitle || purchase.eventTitle
    : purchase.eventTitle;
}

function purchaseStatusLabel(status: ContactDetailTicketPurchase["status"]): string {
  if (status === "paid") return "Paid";
  if (status === "refunded") return "Refunded";
  if (status === "expired") return "Expired";
  return "Pending";
}

function emailConsentDisplay(detail: ContactDetail): {
  readonly badgeClass: string;
  readonly description: string;
  readonly label: string;
} {
  const pref = findPreference(detail, "email");
  const status = pref?.status ?? "unknown";
  const purchases = detail.activity.ticketPurchases;
  const optedInPurchase = purchases.find((purchase) => purchase.marketingOptIn);
  const latestPurchase = purchases[0];

  if (status === "subscribed") {
    if (optedInPurchase) {
      return {
        badgeClass: "status-pill status-pill--success",
        description: `Opted in to marketing emails during checkout for ${purchaseItemTitle(optedInPurchase)} on ${formatShortDate(optedInPurchase.createdAt)}.`,
        label: "Subscribed",
      };
    }
    const observedSuffix = pref?.observedAt ? ` on ${formatShortDate(pref.observedAt)}` : "";
    return {
      badgeClass: "status-pill status-pill--success",
      description: `Subscribed to marketing emails${observedSuffix}.`,
      label: "Subscribed",
    };
  }

  if (status === "unsubscribed") {
    const observedSuffix = pref?.observedAt ? ` on ${formatShortDate(pref.observedAt)}` : "";
    return {
      badgeClass: "status-pill status-pill--warning",
      description: `Unsubscribed${observedSuffix}. Excluded from marketing campaigns.`,
      label: "Unsubscribed",
    };
  }

  if (latestPurchase || isTicketPurchaseSource(detail.contact.source)) {
    return {
      badgeClass: "status-pill status-pill--neutral",
      description:
        "Did not opt in to marketing emails at checkout. Transactional ticket receipts are still sent.",
      label: "Not opted in",
    };
  }

  return {
    badgeClass: "status-pill status-pill--neutral",
    description: "No email marketing consent recorded.",
    label: "Unknown",
  };
}

function smsConsentDisplay(detail: ContactDetail): {
  readonly badgeClass: string;
  readonly description: string;
  readonly label: string;
} {
  const pref = findPreference(detail, "sms");
  const status = pref?.status ?? "unknown";
  if (status === "subscribed") {
    const observedSuffix = pref?.observedAt ? ` on ${formatShortDate(pref.observedAt)}` : "";
    return {
      badgeClass: "status-pill status-pill--success",
      description: `Subscribed to SMS updates${observedSuffix}.`,
      label: "Subscribed",
    };
  }
  if (status === "unsubscribed") {
    const observedSuffix = pref?.observedAt ? ` on ${formatShortDate(pref.observedAt)}` : "";
    return {
      badgeClass: "status-pill status-pill--warning",
      description: `Unsubscribed from SMS${observedSuffix}.`,
      label: "Unsubscribed",
    };
  }
  return {
    badgeClass: "status-pill status-pill--neutral",
    description: "No SMS consent recorded.",
    label: "Unknown",
  };
}

function originSummarySentence(detail: ContactDetail): string {
  const sourceLabel = formatContactSourceLabel(detail.contact.source);
  const purchases = detail.activity.ticketPurchases;
  const latestPurchase = purchases[0];
  const emailStatus = channelStatus(detail, "email");

  if (latestPurchase) {
    const title = purchaseItemTitle(latestPurchase);
    const ticketLabel = `${String(latestPurchase.quantity)} ${latestPurchase.quantity === 1 ? "ticket" : "tickets"}`;
    const optInNote =
      emailStatus === "unsubscribed"
        ? "Later unsubscribed from marketing emails."
        : latestPurchase.marketingOptIn
          ? "Opted in to marketing emails during checkout."
          : "Did not opt in to marketing emails at checkout.";
    if (purchases.length === 1 && isTicketPurchaseSource(detail.contact.source)) {
      return `${sourceLabel} for ${title} (${ticketLabel}). ${optInNote}`;
    }
    return `${sourceLabel}. Most recent ticket order: ${title} (${formatShortDate(latestPurchase.createdAt)}, ${ticketLabel}). ${optInNote}`;
  }

  if (detail.activity.donationCount > 0) {
    const donationText = `${String(detail.activity.donationCount)} ${detail.activity.donationCount === 1 ? "donation" : "donations"}`;
    return `${sourceLabel}. Linked to ${donationText}.`;
  }

  return `${sourceLabel}.`;
}

function lastEmailLabel(lastEmailAt: string | null): string {
  if (!lastEmailAt) return "No marketing email sent yet";
  return formatDateTime(lastEmailAt);
}

function ContactDetailOverviewPanel({
  detail,
  onSelectTab,
}: {
  readonly detail: ContactDetail;
  readonly onSelectTab: (tab: ContactDetailTab) => void;
}) {
  const emailDisplay = emailConsentDisplay(detail);
  const smsDisplay = smsConsentDisplay(detail);
  const ticketCount = detail.activity.ticketPurchaseCount;
  const donationCount = detail.activity.donationCount;
  const listCount = detail.lists.length;

  return (
    <div className="contact-detail__panel">
      <section aria-labelledby="contact-detail-source-heading" className="contact-detail-card">
        <div className="contact-detail-card__header">
          <h3 className="contact-detail-card__title" id="contact-detail-source-heading">
            Source &amp; latest activity
          </h3>
          <span className="contact-detail-card__meta">
            Added {formatShortDate(detail.contact.createdAt)}
          </span>
        </div>
        <p className="contact-detail-card__description">{originSummarySentence(detail)}</p>
        <div className="contact-detail-jumps">
          <button
            className="contact-detail-jump-button"
            onClick={() => {
              onSelectTab("activity");
            }}
            type="button"
          >
            View activity ({String(ticketCount)}{" "}
            {ticketCount === 1 ? "ticket order" : "ticket orders"}, {String(donationCount)}{" "}
            {donationCount === 1 ? "donation" : "donations"}) →
          </button>
          <button
            className="contact-detail-jump-button"
            onClick={() => {
              onSelectTab("lists");
            }}
            type="button"
          >
            View lists ({String(listCount)}) →
          </button>
        </div>
      </section>

      <section
        aria-labelledby="contact-detail-communication-heading"
        className="contact-detail-card"
      >
        <div className="contact-detail-card__header">
          <h3 className="contact-detail-card__title" id="contact-detail-communication-heading">
            Communication &amp; marketing consent
          </h3>
          <span className="contact-detail-card__meta">
            Last email sent: {lastEmailLabel(detail.lastEmailAt)}
          </span>
        </div>
        <div className="contact-detail-channels">
          <div className="contact-detail-channel">
            <div className="contact-detail-channel__top">
              <span className="contact-detail-channel__label">Email marketing</span>
              <span className={emailDisplay.badgeClass}>{emailDisplay.label}</span>
            </div>
            <p className="contact-detail-channel__note">{emailDisplay.description}</p>
          </div>
          <div className="contact-detail-channel">
            <div className="contact-detail-channel__top">
              <span className="contact-detail-channel__label">SMS</span>
              <span className={smsDisplay.badgeClass}>{smsDisplay.label}</span>
            </div>
            <p className="contact-detail-channel__note">{smsDisplay.description}</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="contact-detail-profile-heading" className="contact-detail-card">
        <div className="contact-detail-profile-row">
          <div>
            <h3 className="contact-detail-card__title" id="contact-detail-profile-heading">
              Organization Profile
            </h3>
            <p className="contact-detail-card__description">
              {detail.linkedProfile
                ? `Linked to roster profile ${detail.linkedProfile.displayName}.`
                : "Not linked to a roster profile."}
            </p>
          </div>
          {detail.linkedProfile ? (
            <span className="status-pill status-pill--success">Linked</span>
          ) : (
            <span className="status-pill status-pill--neutral">Not linked</span>
          )}
        </div>
      </section>
    </div>
  );
}

function ContactDetailActivityPanel({ detail }: { readonly detail: ContactDetail }) {
  const purchases = detail.activity.ticketPurchases;
  const ticketCount = detail.activity.ticketPurchaseCount;
  const donationCount = detail.activity.donationCount;

  return (
    <div className="contact-detail__panel">
      <section aria-labelledby="contact-detail-activity-heading" className="contact-detail-card">
        <div className="contact-detail-card__header">
          <div>
            <h3 className="contact-detail-card__title" id="contact-detail-activity-heading">
              Activity
            </h3>
            <p className="contact-detail-card__description">
              Ticket purchases, bundles, and checkout marketing opt-in choices linked to this
              contact.
            </p>
          </div>
          <div className="contact-detail-summary-pills">
            <span className="status-pill status-pill--neutral">
              {String(ticketCount)} {ticketCount === 1 ? "ticket purchase" : "ticket purchases"}
            </span>
            <span className="status-pill status-pill--neutral">
              {String(donationCount)} {donationCount === 1 ? "donation" : "donations"}
            </span>
          </div>
        </div>

        {purchases.length > 0 ? (
          <ul className="contact-detail-activity-list">
            {purchases.map((purchase) => {
              const isBundle = purchase.bundleId !== null;
              return (
                <li className="contact-detail-purchase-row" key={purchase.id}>
                  <div className="contact-detail-purchase-row__main">
                    <div className="contact-detail-purchase-row__title-row">
                      <span className="contact-detail-purchase-row__title">
                        {purchaseItemTitle(purchase)}
                      </span>
                      <span
                        className={
                          isBundle
                            ? "status-pill contact-detail-purchase-row__type--bundle"
                            : "status-pill status-pill--neutral"
                        }
                      >
                        {isBundle ? "Bundle" : "Single"}
                      </span>
                    </div>
                    <span className="contact-detail-purchase-row__meta">
                      {formatShortDate(purchase.createdAt)} · {String(purchase.quantity)}{" "}
                      {purchase.quantity === 1 ? "ticket" : "tickets"} ·{" "}
                      {purchaseStatusLabel(purchase.status)}
                    </span>
                  </div>
                  <span
                    className={
                      purchase.marketingOptIn
                        ? "status-pill status-pill--success"
                        : "status-pill status-pill--neutral"
                    }
                  >
                    {purchase.marketingOptIn ? "Marketing opt-in" : "No marketing opt-in"}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="contact-detail-empty">No ticket purchases linked to this contact.</p>
        )}

        {ticketCount > purchases.length ? (
          <p className="contact-detail-card__meta">
            Showing the {String(purchases.length)} most recent ticket purchases.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function ContactDetailListsPanel({ detail }: { readonly detail: ContactDetail }) {
  const listNames = detail.lists
    .map((list) => list.name)
    .toSorted((left, right) => left.localeCompare(right));

  return (
    <div className="contact-detail__panel">
      <section aria-labelledby="contact-detail-lists-heading" className="contact-detail-card">
        <div>
          <h3 className="contact-detail-card__title" id="contact-detail-lists-heading">
            Lists
          </h3>
          <p className="contact-detail-card__description">
            Audience lists this contact currently belongs to for campaigns and announcements.
          </p>
        </div>
        {listNames.length > 0 ? (
          <ul className="contact-detail-lists">
            {listNames.map((listName) => (
              <li className="contact-detail-list-row" key={listName}>
                <span className="contact-detail-purchase-row__title">{listName}</span>
                <span className="status-pill status-pill--neutral">Member</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="contact-detail-empty">No lists — this contact is not in any lists yet.</p>
        )}
      </section>
    </div>
  );
}

function ContactDetailHeader({
  detail,
  name,
}: {
  readonly detail: ContactDetail;
  readonly name: string;
}) {
  const emailDisplay = emailConsentDisplay(detail);
  const metaParts: string[] = [];
  const trimmedEmail = detail.contact.email?.trim() ?? "";
  const trimmedPhone = detail.contact.phone?.trim() ?? "";
  if (trimmedEmail.length > 0) metaParts.push(trimmedEmail);
  if (trimmedPhone.length > 0) metaParts.push(trimmedPhone);
  metaParts.push(`Added ${formatShortDate(detail.contact.createdAt)}`);

  return (
    <div className="contact-detail-header">
      <div className="contact-detail-header__identity">
        <div aria-hidden="true" className="contact-detail-header__avatar">
          {initialsForName(name)}
        </div>
        <div className="contact-detail-header__details">
          <div className="contact-detail-header__title-row">
            <h2 className="contact-detail-header__name">{name}</h2>
            <span className={emailDisplay.badgeClass}>{emailDisplay.label}</span>
          </div>
          <div className="contact-detail-header__meta">
            {metaParts.map((part, index) => (
              <span key={part}>
                {index > 0 ? (
                  <span aria-hidden="true" className="contact-detail-header__sep">
                    {" · "}
                  </span>
                ) : null}
                {part}
              </span>
            ))}
          </div>
        </div>
      </div>
      <DialogClose asChild>
        <button aria-label="Close" className="dialog__close" type="button">
          ×
        </button>
      </DialogClose>
    </div>
  );
}

export function ContactDetailDialog({
  detail,
  onClose,
  onEdit,
  open,
}: {
  readonly detail: ContactDetail;
  readonly onClose: () => void;
  readonly onEdit?: (() => void) | undefined;
  readonly open: boolean;
}) {
  const name =
    deriveDisplayName({
      displayName: detail.contact.displayName,
      email: detail.contact.email,
      firstName: detail.contact.firstName,
      lastName: detail.contact.lastName,
      phone: detail.contact.phone,
    }) || "Contact details";

  const footer = (
    <div
      className={
        onEdit
          ? "contact-detail-footer-actions"
          : "contact-detail-footer-actions contact-detail-footer-actions--close-only"
      }
    >
      {onEdit ? (
        <button className="button button--secondary" onClick={onEdit} type="button">
          Edit contact
        </button>
      ) : null}
      <DialogClose asChild>
        <button className="button button--secondary" type="button">
          Close
        </button>
      </DialogClose>
    </div>
  );

  return (
    <Dialog
      className="dialog--contact-detail"
      description={`Relationship and activity for ${name}. Contacts never appear on the roster.`}
      dirty={false}
      footer={footer}
      header={<ContactDetailHeader detail={detail} name={name} />}
      onClose={onClose}
      open={open}
      title={name}
    >
      <ContactDetailContent detail={detail} />
    </Dialog>
  );
}

/**
 * Pure detail content (no Dialog wrapper) so tabs, relationships, counts,
 * ticket purchase history, and consent statuses can be verified cleanly in
 * unit and UI tests.
 */
export function ContactDetailContent({
  detail,
  initialTab = "overview",
}: {
  readonly detail: ContactDetail;
  readonly initialTab?: ContactDetailTab;
}) {
  const [activeTab, setActiveTab] = useState<ContactDetailTab>(initialTab);
  const totalActivity = detail.activity.ticketPurchaseCount + detail.activity.donationCount;

  return (
    <Tabs
      className="contact-detail-tabs"
      onValueChange={(value) => {
        setActiveTab(value);
      }}
      orientation="vertical"
      value={activeTab}
    >
      <div className="contact-detail">
        <aside className="contact-detail__rail">
          <div className="contact-detail__rail-top">
            <div className="contact-detail__rail-header">Contact sections</div>
            <TabsList
              aria-label="Contact sections"
              as="nav"
              className="contact-detail__rail-tablist"
            >
              <TabsTrigger
                aria-controls="contact-detail-overview-panel"
                className="contact-detail__rail-trigger"
                id="contact-detail-overview-tab"
                value="overview"
              >
                <span className="contact-detail__rail-trigger-main">Overview &amp; consent</span>
              </TabsTrigger>
              <TabsTrigger
                aria-controls="contact-detail-activity-panel"
                className="contact-detail__rail-trigger"
                id="contact-detail-activity-tab"
                value="activity"
              >
                <span className="contact-detail__rail-trigger-main">Activity</span>
                <span className="contact-detail__rail-count">{String(totalActivity)}</span>
              </TabsTrigger>
              <TabsTrigger
                aria-controls="contact-detail-lists-panel"
                className="contact-detail__rail-trigger"
                id="contact-detail-lists-tab"
                value="lists"
              >
                <span className="contact-detail__rail-trigger-main">Lists</span>
                <span className="contact-detail__rail-count">{String(detail.lists.length)}</span>
              </TabsTrigger>
            </TabsList>
          </div>
          <div className="contact-detail__rail-note">
            <strong>Community contact</strong>
            Contacts never appear on the roster unless linked to an Organization Profile.
          </div>
        </aside>

        <div className="contact-detail__content">
          <TabsContent
            aria-labelledby="contact-detail-overview-tab"
            className="contact-detail__panel"
            forceMount
            id="contact-detail-overview-panel"
            value="overview"
          >
            <ContactDetailOverviewPanel detail={detail} onSelectTab={setActiveTab} />
          </TabsContent>
          <TabsContent
            aria-labelledby="contact-detail-activity-tab"
            className="contact-detail__panel"
            forceMount
            id="contact-detail-activity-panel"
            value="activity"
          >
            <ContactDetailActivityPanel detail={detail} />
          </TabsContent>
          <TabsContent
            aria-labelledby="contact-detail-lists-tab"
            className="contact-detail__panel"
            forceMount
            id="contact-detail-lists-panel"
            value="lists"
          >
            <ContactDetailListsPanel detail={detail} />
          </TabsContent>
        </div>
      </div>
    </Tabs>
  );
}
