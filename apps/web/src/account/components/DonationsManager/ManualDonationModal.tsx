import {
  donationPaymentMethodSchema,
  donationTributeInputSchema,
  type DonationPaymentMethod,
  type DonationTributeInput,
  type ManualDonationCreateRequest,
} from "@choir/contracts";
import { filterDonorSuggestions, type DonorSuggestion } from "@choir/domain";
import { Autocomplete, Dialog, DialogClose } from "@choir/ui";
import { useMemo, useState, type SyntheticEvent } from "react";

import { money } from "./types";

export function ManualDonationModal({
  busy,
  onClose,
  onSave,
  open,
  suggestions,
}: {
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onSave: (donation: ManualDonationCreateRequest) => Promise<void>;
  readonly open: boolean;
  readonly suggestions: readonly DonorSuggestion[];
}) {
  const [amount, setAmount] = useState("");
  const [donorName, setDonorName] = useState("");
  const [donorEmail, setDonorEmail] = useState("");
  const [paymentMethod, setPaymentMethod] =
    useState<Exclude<DonationPaymentMethod, "stripe">>("check");
  const [paymentReference, setPaymentReference] = useState("");
  const [receivedDate, setReceivedDate] = useState(
    () => new Date().toISOString().split("T")[0] ?? "",
  );
  const [tributeType, setTributeType] = useState<DonationTributeInput>("none");
  const [tributeName, setTributeName] = useState("");
  const [tributeNotifyEmail, setTributeNotifyEmail] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [thankYouSent, setThankYouSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filteredSuggestions = useMemo(
    () => filterDonorSuggestions(suggestions, donorName),
    [donorName, suggestions],
  );
  const suggestionById = useMemo(
    () => new Map(filteredSuggestions.map((suggestion) => [suggestion.key, suggestion])),
    [filteredSuggestions],
  );
  const donorOptions = useMemo(
    () => filteredSuggestions.map((suggestion) => ({ id: suggestion.key, label: suggestion.name })),
    [filteredSuggestions],
  );

  function reset(): void {
    setAmount("");
    setDonorName("");
    setDonorEmail("");
    setPaymentMethod("check");
    setPaymentReference("");
    setReceivedDate(new Date().toISOString().split("T")[0] ?? "");
    setTributeType("none");
    setTributeName("");
    setTributeNotifyEmail("");
    setAnonymous(false);
    setThankYouSent(false);
    setError(null);
  }

  async function handleSubmit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    const amountCents = Math.round(Number(amount) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setError("Provide a valid positive donation amount.");
      return;
    }
    if (!donorName.trim()) {
      setError("Donor name is required.");
      return;
    }

    const payload: ManualDonationCreateRequest = {
      amountCents,
      anonymous,
      buyerEmail: donorEmail.trim(),
      buyerName: donorName.trim(),
      marketingConsent: false,
      paymentMethod,
      paymentReference: paymentReference.trim(),
      receivedAt: receivedDate
        ? new Date(`${receivedDate}T12:00:00.000Z`).toISOString()
        : undefined,
      thankYouSent,
      tributeName: tributeType !== "none" ? tributeName.trim() : "",
      tributeNotifyEmail: tributeType !== "none" ? tributeNotifyEmail.trim() : "",
      tributeType,
    };

    try {
      await onSave(payload);
      reset();
      onClose();
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The manual donation could not be recorded.",
      );
    }
  }

  return (
    <Dialog
      description="Record an offline gift received via check, cash, bank transfer, or other offline method."
      onClose={() => {
        reset();
        onClose();
      }}
      open={open}
      title="Record donation"
    >
      {error ? (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      ) : null}
      <form className="form-stack manual-donation-form" onSubmit={(event) => void handleSubmit(event)}>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="manual-donation-amount">Amount (USD)</label>
            <input
              autoFocus
              disabled={busy}
              id="manual-donation-amount"
              min="0.01"
              onChange={(event) => {
                setAmount(event.target.value);
              }}
              placeholder="0.00"
              required
              step="0.01"
              type="number"
              value={amount}
            />
          </div>
          <div className="field">
            <label htmlFor="manual-donation-received-date">Date received</label>
            <input
              disabled={busy}
              id="manual-donation-received-date"
              onChange={(event) => {
                setReceivedDate(event.target.value);
              }}
              type="date"
              value={receivedDate}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="manual-donation-donor-name">Donor name</label>
          <Autocomplete
            ariaLabel="Donor name"
            disabled={busy}
            id="manual-donation-donor-name"
            onSelect={(option) => {
              setDonorName(option.label);
              const suggestion = suggestionById.get(option.id);
              if (suggestion?.email) setDonorEmail(suggestion.email);
            }}
            onValueChange={(next) => {
              setDonorName(next);
            }}
            options={donorOptions}
            placeholder="Jane Doe or Acme Foundation"
            renderOption={(option) => {
              const suggestion = suggestionById.get(option.id);
              if (!suggestion) return option.label;
              return (
                <>
                  <span>{suggestion.name}</span>
                  {suggestion.email ? (
                    <span className="autocomplete__option-meta">{suggestion.email}</span>
                  ) : null}
                  {suggestion.sources.includes("donor") ? (
                    <span className="autocomplete__badge">
                      Donor
                      {suggestion.totalDonatedCents !== null
                        ? ` · ${money(suggestion.totalDonatedCents)}`
                        : ""}
                    </span>
                  ) : null}
                  {suggestion.sources.includes("buyer") ? (
                    <span className="autocomplete__badge">Ticket buyer</span>
                  ) : null}
                  {suggestion.sources.includes("member") ? (
                    <span className="autocomplete__badge">Member</span>
                  ) : null}
                </>
              );
            }}
            required
            value={donorName}
          />
        </div>

        <div className="field">
          <label className="manual-donation-field-label" htmlFor="manual-donation-donor-email">
            <span>Donor email</span>
            <span className="field-help field-help--inline">(Optional)</span>
          </label>
          <input
            aria-describedby="manual-donation-donor-email-help"
            disabled={busy}
            id="manual-donation-donor-email"
            maxLength={320}
            onChange={(event) => {
              setDonorEmail(event.target.value);
            }}
            placeholder="donor@example.com"
            type="email"
            value={donorEmail}
          />
          <span className="field-help" id="manual-donation-donor-email-help">
            Links to patron giving history.
          </span>
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="manual-donation-payment-method">Payment method</label>
            <select
              disabled={busy}
              id="manual-donation-payment-method"
              onChange={(event) => {
                const parsed = donationPaymentMethodSchema
                  .exclude(["stripe"])
                  .safeParse(event.target.value);
                if (parsed.success) setPaymentMethod(parsed.data);
              }}
              value={paymentMethod}
            >
              <option value="check">Check</option>
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank transfer / ACH</option>
              <option value="card_offline">Credit / Debit Card (Offline)</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="field">
            <label
              className="manual-donation-field-label"
              htmlFor="manual-donation-payment-reference"
            >
              <span>Check # / Reference note</span>
              <span className="field-help field-help--inline">(Optional)</span>
            </label>
            <input
              disabled={busy}
              id="manual-donation-payment-reference"
              maxLength={500}
              onChange={(event) => {
                setPaymentReference(event.target.value);
              }}
              placeholder="e.g. Check #1042"
              type="text"
              value={paymentReference}
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="manual-donation-tribute">Tribute</label>
          <select
            disabled={busy}
            id="manual-donation-tribute"
            onChange={(event) => {
              const parsed = donationTributeInputSchema.safeParse(event.target.value);
              if (parsed.success) setTributeType(parsed.data);
            }}
            value={tributeType}
          >
            <option value="none">None</option>
            <option value="honor">In Honor Of</option>
            <option value="memory">In Memory Of</option>
          </select>
        </div>

        {tributeType === "honor" || tributeType === "memory" ? (
          <div className="form-grid">
            <div className="field">
              <label htmlFor="manual-donation-tribute-name">Honoree / Memorial name</label>
              <input
                disabled={busy}
                id="manual-donation-tribute-name"
                maxLength={500}
                onChange={(event) => {
                  setTributeName(event.target.value);
                }}
                placeholder="Honoree name"
                type="text"
                value={tributeName}
              />
            </div>
            <div className="field">
              <label
                className="manual-donation-field-label"
                htmlFor="manual-donation-tribute-notify-email"
              >
                <span>Notification email</span>
                <span className="field-help field-help--inline">(Optional)</span>
              </label>
              <input
                disabled={busy}
                id="manual-donation-tribute-notify-email"
                maxLength={320}
                onChange={(event) => {
                  setTributeNotifyEmail(event.target.value);
                }}
                placeholder="family@example.com"
                type="email"
                value={tributeNotifyEmail}
              />
            </div>
          </div>
        ) : null}

        <div className="manual-donation-options">
          <label className="checkbox-field">
            <input
              checked={anonymous}
              disabled={busy}
              onChange={(event) => {
                setAnonymous(event.target.checked);
              }}
              type="checkbox"
            />
            <span>Mark as anonymous (hide donor name from public recognition)</span>
          </label>

          <label className="checkbox-field">
            <input
              checked={thankYouSent}
              disabled={busy}
              onChange={(event) => {
                setThankYouSent(event.target.checked);
              }}
              type="checkbox"
            />
            <span>Thank-you letter or acknowledgment has already been sent</span>
          </label>
        </div>

        <div className="dialog__actions">
          <button className="button button--primary" disabled={busy} type="submit">
            {busy ? "Recording…" : "Record donation"}
          </button>
          <DialogClose asChild>
            <button className="button button--secondary" disabled={busy} type="button">
              Cancel
            </button>
          </DialogClose>
        </div>
      </form>
    </Dialog>
  );
}
