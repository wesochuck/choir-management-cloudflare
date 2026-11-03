import { useEffect, useState } from "react";
import type { OrganizationBranding } from "@choir/contracts";
import {
  checkoutReminderTemplates,
  checkoutReminderPlaceholderTags,
  renderCommunicationTemplate,
  composeCheckoutReminderActions,
} from "@choir/domain";
import { getOrganizationBranding } from "../../../api/organization";
import { renderCommunicationMarkdownPreview } from "../../communicationMarkdown";

export function CheckoutReminderTemplatePreview({
  templateId,
  subject,
  content,
}: {
  readonly templateId: string;
  readonly subject: string;
  readonly content: string;
}) {
  const [branding, setBranding] = useState<OrganizationBranding | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    getOrganizationBranding(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setBranding(value);
      })
      .catch(() => {
        /* Sample preview remains available without branding. */
      });
    return () => {
      controller.abort();
    };
  }, []);
  const template = checkoutReminderTemplates.find((candidate) => candidate.id === templateId);
  if (!template) return null;
  const values = {
    organizationName: branding?.organizationName ?? "Example Choir",
    checkoutSummary:
      template.kind === "ticket" ? "2 tickets for Spring Concert" : "Donation: $50.00",
    eventTitle: "Spring Concert",
    eventDate: "May 15 at 7:00 PM",
    donationAmount: "$50.00",
    donationLevel: "Supporter",
    returnUrl: "https://example.invalid/checkout/return",
  };
  const body = composeCheckoutReminderActions(
    renderCommunicationTemplate(content, "Alex", values),
    values.returnUrl,
    "https://example.invalid/checkout/reminders/stop",
  );
  return (
    <section aria-label="Complete reminder email preview">
      <h3>Email preview</h3>
      <p>{values.organizationName}</p>
      <p>
        <strong>{renderCommunicationTemplate(subject, "Alex", values)}</strong>
      </p>
      <div
        onClick={(event) => {
          event.preventDefault();
        }}
        dangerouslySetInnerHTML={{
          __html: renderCommunicationMarkdownPreview(body, {}, { branding, channel: "Email" }),
        }}
      />
      <p>{branding?.physicalAddress ?? "Organization mailing address"}</p>
      <p className="field-help">
        Preview links are examples. The return button, stop link, and sender footer are always
        included.
      </p>
      <p className="field-help">
        Supported placeholders: {checkoutReminderPlaceholderTags(template.kind).join(", ")}
      </p>
    </section>
  );
}
