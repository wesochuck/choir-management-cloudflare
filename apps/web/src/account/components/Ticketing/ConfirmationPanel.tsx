import type { CommunicationTemplate, TicketConfirmationSettings } from "@choir/contracts";
import { Dialog, DialogClose } from "@choir/ui";
import {
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
  type SyntheticEvent,
} from "react";
import {
  listOrganizationCommunicationTemplates,
  updateOrganizationCommunicationTemplate,
} from "../../../auth/api";
import { SystemTemplateResetAction } from "../SystemTemplateResetAction";

const TICKET_TEMPLATE_IDS = new Set([
  "5f0ca4a5-7e4c-4e1a-9a1c-000000000007",
  "5f0ca4a5-7e4c-4e1a-9a1c-000000000008",
  "5f0ca4a5-7e4c-4e1a-9a1c-000000000009",
  "5f0ca4a5-7e4c-4e1a-9a1c-000000000017",
  "5f0ca4a5-7e4c-4e1a-9a1c-000000000018",
]);

const PLACEHOLDER_GUIDE = [
  { code: "{buyerName}", desc: "Customer name on the order" },
  { code: "{eventTitle}", desc: "Performance or concert title" },
  { code: "{eventDate}", desc: "Formatted date and time of the event" },
  { code: "{venueName}", desc: "Performance venue name" },
  { code: "{venueAddress}", desc: "Venue street address and location" },
  { code: "{ticketQuantity}", desc: "Number of tickets ordered" },
  { code: "{ticketAmount}", desc: "Total amount charged" },
  { code: "{ticketOriginalSubtotal}", desc: "Original subtotal before discounts" },
  { code: "{ticketDiscount}", desc: "Discount savings amount" },
  { code: "{ticketDiscountCode}", desc: "Promo or discount code applied" },
  { code: "{ticketSubtotal}", desc: "Subtotal after discounts" },
  { code: "{ticketFee}", desc: "Processing fee charged, if any" },
  { code: "{ticketBundleName}", desc: "Ticket bundle package name" },
  { code: "{refundAmount}", desc: "Refund amount (for refund messages)" },
  { code: "{refundDate}", desc: "Refund processed date and time (for refund messages)" },
  { code: "{{TICKET_LINK}}", desc: "Link to online receipt and admission QR code" },
  { code: "{{TICKET_ORDER_LINK}}", desc: "Refund-safe link to order details" },
  {
    code: "{{TICKET_EVENT_LIST}}",
    desc: "Included concerts in date order, with each title, date and time, venue, and address or event-location fallback",
  },
] as const;

function isTicketTemplate(template: CommunicationTemplate): boolean {
  return template.isSystem && TICKET_TEMPLATE_IDS.has(template.id);
}

export function ConfirmationPanel({
  confirmationDraft,
  confirmationLoadError,
  confirmationLoaded,
  confirmationSaving,
  onSubmit,
  setConfirmationDraft,
}: {
  readonly confirmationDraft: TicketConfirmationSettings;
  readonly confirmationLoadError: string | null;
  readonly confirmationLoaded: boolean;
  readonly confirmationSaving: boolean;
  readonly onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
  readonly setConfirmationDraft: Dispatch<SetStateAction<TicketConfirmationSettings>>;
}) {
  const [templates, setTemplates] = useState<readonly CommunicationTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  const [editingTemplate, setEditingTemplate] = useState<CommunicationTemplate | null>(null);
  const [editSubject, setEditSubject] = useState("");
  const [editContent, setEditContent] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateActionError, setTemplateActionError] = useState<string | null>(null);
  const [templateActionSuccess, setTemplateActionSuccess] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    listOrganizationCommunicationTemplates(controller.signal)
      .then((loaded) => {
        if (!controller.signal.aborted) {
          setTemplates(loaded.filter(isTicketTemplate));
          setTemplatesError(null);
        }
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setTemplatesError(
            err instanceof Error ? err.message : "Failed to load ticket email templates.",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setTemplatesLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, []);

  function handleStartEdit(template: CommunicationTemplate) {
    setEditingTemplate(template);
    setEditSubject(template.subject);
    setEditContent(template.contentMarkdown);
    setTemplateActionError(null);
    setTemplateActionSuccess(null);
  }

  async function handleSaveTemplate(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingTemplate) return;

    setSavingTemplate(true);
    setTemplateActionError(null);
    try {
      const updated = await updateOrganizationCommunicationTemplate(editingTemplate.id, {
        channel: editingTemplate.channel,
        contentMarkdown: editContent,
        subject: editSubject,
        title: editingTemplate.title,
      });
      setTemplates((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setEditingTemplate(null);
    } catch (err: unknown) {
      setTemplateActionError(
        err instanceof Error ? err.message : "Failed to save communication template.",
      );
    } finally {
      setSavingTemplate(false);
    }
  }

  function handleTemplateReset(template: CommunicationTemplate) {
    setTemplates((current) => current.map((item) => (item.id === template.id ? template : item)));
    setEditingTemplate(null);
    setTemplateActionSuccess(`${template.title} reset to the system default.`);
  }

  return confirmationLoaded ? (
    <div
      aria-labelledby="ticketing-confirmation-tab"
      className="ticket-confirmation-settings"
      id="ticketing-confirmation-panel"
      role="tabpanel"
    >
      <form
        aria-label="Admission and confirmation page wording"
        onSubmit={(event) => {
          onSubmit(event);
        }}
      >
        <fieldset className="ticket-confirmation-settings__fieldset">
          <legend>Admission and confirmation page wording</legend>
          <div className="ticket-confirmation-settings__grid">
            <div className="field">
              <label htmlFor="ticket-success-message">Success Message</label>
              <textarea
                id="ticket-success-message"
                onChange={(event) => {
                  setConfirmationDraft((current) => ({
                    ...current,
                    successMessage: event.target.value,
                  }));
                }}
                rows={3}
                value={confirmationDraft.successMessage}
              />
            </div>
            <div className="field">
              <label htmlFor="ticket-pending-message">Pending / Unverified Message</label>
              <textarea
                id="ticket-pending-message"
                onChange={(event) => {
                  setConfirmationDraft((current) => ({
                    ...current,
                    pendingMessage: event.target.value,
                  }));
                }}
                rows={3}
                value={confirmationDraft.pendingMessage}
              />
            </div>
            <div className="field">
              <label htmlFor="ticket-admission-instructions">Admission Instructions</label>
              <textarea
                id="ticket-admission-instructions"
                onChange={(event) => {
                  const val = event.target.value;
                  setConfirmationDraft((current) => ({
                    ...current,
                    admissionInstructions: val,
                    willCallInstructions: val,
                  }));
                }}
                rows={4}
                value={confirmationDraft.admissionInstructions}
              />
            </div>
            <div className="field">
              <label htmlFor="ticket-qr-code-instructions">QR Code Instructions</label>
              <textarea
                id="ticket-qr-code-instructions"
                onChange={(event) => {
                  setConfirmationDraft((current) => ({
                    ...current,
                    qrCodeInstructions: event.target.value,
                  }));
                }}
                rows={4}
                value={confirmationDraft.qrCodeInstructions}
              />
            </div>
          </div>
          <div className="form-actions">
            <button className="button button--primary" disabled={confirmationSaving} type="submit">
              {confirmationSaving ? "Saving…" : "Save ticket wording"}
            </button>
          </div>
        </fieldset>
      </form>

      <section className="ticket-confirmation-settings__fieldset">
        <header className="ticket-template-section-header">
          <h3>Ticket email templates</h3>
          <p className="ticket-confirmation-settings__hint">
            Customize transactional emails sent to ticket buyers. Templates are backed by the
            organization communication template registry.
          </p>
        </header>

        {templateActionSuccess ? (
          <p className="notice notice--success" role="status">
            {templateActionSuccess}
          </p>
        ) : null}

        {templatesLoading ? (
          <p>Loading ticket email templates…</p>
        ) : templatesError ? (
          <p className="notice notice--error" role="alert">
            {templatesError}
          </p>
        ) : templates.length === 0 ? (
          <p>No ticket email templates found.</p>
        ) : (
          <div className="ticket-template-list">
            {templates.map((template) => (
              <article className="ticket-template-card" key={template.id}>
                <div className="ticket-template-card__header">
                  <div>
                    <h4>{template.title}</h4>
                    <p className="ticket-template-card__subject">Subject: {template.subject}</p>
                  </div>
                  <button
                    className="button button--secondary button--sm"
                    onClick={() => {
                      handleStartEdit(template);
                    }}
                    type="button"
                  >
                    Edit wording
                  </button>
                </div>
                <div className="ticket-template-card__preview">
                  <p>
                    {template.contentMarkdown.slice(0, 160)}
                    {template.contentMarkdown.length > 160 ? "…" : ""}
                  </p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* Edit Template Dialog */}
      <Dialog
        description="Customize the subject and message body for this ticket notification email."
        onClose={() => {
          if (!savingTemplate) setEditingTemplate(null);
        }}
        open={editingTemplate !== null}
        title={editingTemplate ? `Edit ${editingTemplate.title}` : "Edit template"}
      >
        {editingTemplate ? (
          <form
            onSubmit={(e) => {
              void handleSaveTemplate(e);
            }}
          >
            {templateActionError ? (
              <p className="notice notice--error" role="alert">
                {templateActionError}
              </p>
            ) : null}
            <div className="field">
              <label htmlFor="edit-ticket-template-subject">Subject</label>
              <input
                id="edit-ticket-template-subject"
                maxLength={300}
                onChange={(e) => {
                  setEditSubject(e.target.value);
                }}
                required
                value={editSubject}
              />
            </div>
            <div className="field">
              <label htmlFor="edit-ticket-template-content">Message</label>
              <textarea
                id="edit-ticket-template-content"
                maxLength={100_000}
                onChange={(e) => {
                  setEditContent(e.target.value);
                }}
                required
                rows={10}
                value={editContent}
              />
            </div>

            <div className="ticket-template-placeholders">
              <h5>Available placeholders</h5>
              <p className="ticket-template-placeholders__hint">
                Insert placeholders into your message or subject to include dynamic order details:
              </p>
              <div className="ticket-template-placeholders__grid">
                {PLACEHOLDER_GUIDE.map((p) => (
                  <button
                    className="ticket-placeholder-chip"
                    key={p.code}
                    onClick={() => {
                      setEditContent((prev) => `${prev} ${p.code}`);
                    }}
                    title={p.desc}
                    type="button"
                  >
                    <code>{p.code}</code>
                    <span>{p.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            <SystemTemplateResetAction
              disabled={savingTemplate}
              onReset={handleTemplateReset}
              template={editingTemplate}
            />
            <div className="dialog__actions">
              <DialogClose asChild>
                <button
                  className="button button--secondary"
                  disabled={savingTemplate}
                  type="button"
                >
                  Cancel
                </button>
              </DialogClose>
              <button
                className="button button--primary"
                disabled={savingTemplate || !editSubject.trim() || !editContent.trim()}
                type="submit"
              >
                {savingTemplate ? "Saving…" : "Save template"}
              </button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </div>
  ) : (
    <div
      aria-labelledby="ticketing-confirmation-tab"
      id="ticketing-confirmation-panel"
      role="tabpanel"
    >
      <p className="notice notice--error" role="alert">
        {confirmationLoadError ?? "Loading ticket confirmation wording…"}
      </p>
    </div>
  );
}
