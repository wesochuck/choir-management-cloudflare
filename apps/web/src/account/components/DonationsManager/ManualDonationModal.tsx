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
      <form className="form-stack" onSubmit={(event) => void handleSubmit(event)}>
        <div className="form-grid">
          <label className="field">
            Amount (USD)
            <input
              autoFocus
              disabled={busy}
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
          </label>
          <label className="field">
            Date received
            <input
              disabled={busy}
              onChange={(event) => {
                setReceivedDate(event.target.value);
              }}
              type="date"
              value={receivedDate}
            />
          </label>
        </div>

        <label className="field">
          Donor name
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
        </label>

        <label className="field">
          Donor email{" "}
          <span className="field-help">(Optional — links to patron giving history)</span>
          <input
            disabled={busy}
            maxLength={320}
            onChange={(event) => {
              setDonorEmail(event.target.value);
            }}
            placeholder="donor@example.com"
            type="email"
            value={donorEmail}
          />
        </label>

        <div className="form-grid">
          <label className="field">
            Payment method
            <select
              disabled={busy}
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
          </label>
          <label className="field">
            Check # / Reference note <span className="field-help">(Optional)</span>
            <input
              disabled={busy}
              maxLength={500}
              onChange={(event) => {
                setPaymentReference(event.target.value);
              }}
              placeholder="e.g. Check #1042"
              type="text"
              value={paymentReference}
            />
          </label>
        </div>

        <label className="field">
          Tribute
          <select
            disabled={busy}
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
        </label>

        {tributeType === "honor" || tributeType === "memory" ? (
          <div className="form-grid">
            <label className="field">
              Honoree / Memorial name
              <input
                disabled={busy}
                maxLength={500}
                onChange={(event) => {
                  setTributeName(event.target.value);
                }}
                placeholder="Honoree name"
                type="text"
                value={tributeName}
              />
            </label>
            <label className="field">
              Notification email <span className="field-help">(Optional)</span>
              <input
                disabled={busy}
                maxLength={320}
                onChange={(event) => {
                  setTributeNotifyEmail(event.target.value);
                }}
                placeholder="family@example.com"
                type="email"
                value={tributeNotifyEmail}
              />
            </label>
          </div>
        ) : null}

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
