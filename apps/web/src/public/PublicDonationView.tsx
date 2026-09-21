import type { DonationSettings, TransactionFeeSettings } from "@choir/contracts";
import { transactionProcessingFeeCents } from "@choir/domain";
import { useEffect, useState, type SyntheticEvent } from "react";

import {
  checkoutPublicDonation,
  getPublicDonationSettings,
  getPublicTransactionFeeSettings,
} from "../api";

const DEFAULT_SETTINGS: DonationSettings = {
  buttonText: "Support our Music",
  description:
    "Your contribution helps us keep the music playing and supports our mission in the community.",
  levels: [
    { amountCents: 2_500, benefit: "Mention in program", id: "level-1", label: "Friend" },
    { amountCents: 5_000, benefit: "Mention in program", id: "level-2", label: "Supporter" },
    { amountCents: 10_000, benefit: "Priority seating", id: "level-3", label: "Patron" },
    {
      amountCents: 25_000,
      benefit: "Invitation to VIP reception",
      id: "level-4",
      label: "Benefactor",
    },
  ],
};

const DEFAULT_TRANSACTION_FEE_SETTINGS: TransactionFeeSettings = {
  fixedCents: 30,
  passFeeToDonor: false,
  percentage: 2.9,
};

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { currency: "USD", style: "currency" }).format(
    cents / 100,
  );
}

const TRIBUTE_OPTIONS: readonly {
  readonly label: string;
  readonly value: "none" | "honor" | "memory" | "anonymous";
}[] = [
  { label: "No tribute", value: "none" },
  { label: "In honor of", value: "honor" },
  { label: "In memory of", value: "memory" },
  { label: "Anonymous tribute", value: "anonymous" },
];

// eslint-disable-next-line complexity -- PublicDonationView coordinates donation levels, custom amount, tribute options, fees, and checkout.
export function PublicDonationView() {
  const [settings, setSettings] = useState<DonationSettings>(DEFAULT_SETTINGS);
  const [transactionFeeSettings, setTransactionFeeSettings] = useState<TransactionFeeSettings>(
    DEFAULT_TRANSACTION_FEE_SETTINGS,
  );
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [selectedLevelId, setSelectedLevelId] = useState("level-1");
  const [amountCents, setAmountCents] = useState(DEFAULT_SETTINGS.levels[0]?.amountCents ?? 2_500);
  const [customAmount, setCustomAmount] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [tributeType, setTributeType] = useState<"honor" | "memory" | "anonymous" | "none">("none");
  const [tributeName, setTributeName] = useState("");
  const [tributeNotifyEmail, setTributeNotifyEmail] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkoutRequestId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      getPublicDonationSettings(controller.signal),
      getPublicTransactionFeeSettings(controller.signal),
    ])
      .then(([loaded, feeSettings]) => {
        setSettings(loaded);
        setTransactionFeeSettings(feeSettings);
        const first = loaded.levels[0];
        if (first) {
          setSelectedLevelId(first.id);
          setAmountCents(first.amountCents);
        } else {
          setSelectedLevelId("custom");
          setUseCustom(true);
          setAmountCents(0);
          setCustomAmount("");
        }
      })
      .catch(() => {
        setLoadError("Donation options could not be loaded. Please try again later.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setSettingsLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, []);

  function selectLevel(levelId: string, cents: number): void {
    setSelectedLevelId(levelId);
    setUseCustom(false);
    setAmountCents(cents);
  }

  const feeCents = transactionFeeSettings.passFeeToDonor
    ? transactionProcessingFeeCents(amountCents, transactionFeeSettings)
    : 0;

  function handleCustomChange(value: string) {
    setCustomAmount(value);
    setUseCustom(true);
    const parsed = Number(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) {
      setAmountCents(Math.round(parsed * 100));
    }
  }

  async function submit(formEvent: SyntheticEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (buyerEmail.trim().toLowerCase() !== confirmEmail.trim().toLowerCase()) {
      setError("Email addresses must match.");
      return;
    }
    if (amountCents < 100) {
      setError("The minimum donation is $1.00.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await checkoutPublicDonation({
        amountCents,
        anonymous,
        buyerEmail: buyerEmail.trim(),
        buyerName: buyerName.trim(),
        checkoutRequestId,
        marketingConsent,
        tributeName,
        tributeNotifyEmail,
        tributeType,
      });
      window.location.assign(result.url || "/donate/success");
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : "The donation could not be completed.");
      setBusy(false);
    }
  }

  return (
    <section className="public-section public-donation-section">
      <h1>{settings.buttonText}</h1>
      <p>{settings.description}</p>
      {settingsLoading ? <p className="notice notice--info">Loading donation options…</p> : null}
      {loadError ? (
        <p className="notice notice--error" role="alert">
          {loadError}
        </p>
      ) : null}
      <form className="panel public-donation-form" onSubmit={(formEvent) => void submit(formEvent)}>
        {error ? (
          <p className="notice notice--error" id="donation-form-error" role="alert">
            {error}
          </p>
        ) : null}
        <fieldset className="field public-donation-level-fieldset">
          <legend>Select a donation level</legend>
          <div className="donation-level-grid">
            {settings.levels.map((level) => (
              <button
                className={`donation-level-option ${!useCustom && selectedLevelId === level.id ? "is-selected" : ""}`}
                disabled={busy}
                key={level.id}
                onClick={() => {
                  selectLevel(level.id, level.amountCents);
                }}
                type="button"
              >
                <span>
                  <strong>{level.label}</strong>
                  {level.benefit ? <small>{level.benefit}</small> : null}
                </span>
                <strong>{money(level.amountCents)}</strong>
              </button>
            ))}
            <button
              className={`donation-level-option ${useCustom ? "is-selected" : ""}`}
              disabled={busy}
              onClick={() => {
                setUseCustom(true);
                setSelectedLevelId("custom");
              }}
              type="button"
            >
              <strong>Custom amount</strong>
            </button>
          </div>
          {useCustom ? (
            <label className="field public-donation-custom-field">
              Custom amount
              <input
                aria-describedby={error ? "donation-form-error" : undefined}
                aria-invalid={Boolean(error && amountCents < 100)}
                inputMode="decimal"
                maxLength={10}
                min="0"
                onChange={(e) => {
                  handleCustomChange(e.target.value);
                }}
                placeholder="0.00"
                step="0.01"
                type="text"
                value={customAmount}
              />
            </label>
          ) : null}
        </fieldset>

        <div className="public-donation-body">
          <div className="public-donation-main">
            <fieldset className="field public-donation-tribute-fieldset">
              <legend>Tribute (optional)</legend>
              <div
                aria-label="Tribute (optional)"
                className="donation-tribute-options"
                role="radiogroup"
              >
                {TRIBUTE_OPTIONS.map((option) => (
                  <label
                    className={`donation-tribute-option ${tributeType === option.value ? "is-selected" : ""}`}
                    key={option.value}
                  >
                    <input
                      checked={tributeType === option.value}
                      name="tributeType"
                      onChange={() => {
                        setTributeType(option.value);
                      }}
                      type="radio"
                      value={option.value}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
              {tributeType === "honor" || tributeType === "memory" ? (
                <div className="public-donation-tribute-fields">
                  <label className="field">
                    {tributeType === "honor" ? "Honoree name" : "Person to memorialize"}
                    <input
                      maxLength={500}
                      onChange={(e) => {
                        setTributeName(e.target.value);
                      }}
                      required
                      value={tributeName}
                    />
                  </label>
                  <label className="field">
                    Notification email (optional)
                    <input
                      maxLength={320}
                      onChange={(e) => {
                        setTributeNotifyEmail(e.target.value);
                      }}
                      type="email"
                      value={tributeNotifyEmail}
                    />
                  </label>
                </div>
              ) : null}
            </fieldset>

            <fieldset className="field public-donation-info-fieldset">
              <legend>Your information</legend>
              <div className="public-donation-contact-grid">
                <label className="field">
                  Name
                  <input
                    aria-describedby={error ? "donation-form-error" : undefined}
                    maxLength={200}
                    onChange={(e) => {
                      setBuyerName(e.target.value);
                    }}
                    required
                    value={buyerName}
                  />
                </label>
                <label className="field">
                  Email
                  <input
                    aria-describedby={error ? "donation-form-error" : undefined}
                    onChange={(e) => {
                      setBuyerEmail(e.target.value);
                    }}
                    required
                    type="email"
                    value={buyerEmail}
                  />
                </label>
                <label className="field">
                  Confirm email
                  <input
                    aria-describedby={error ? "donation-form-error" : undefined}
                    aria-invalid={Boolean(error?.toLowerCase().includes("email"))}
                    onChange={(e) => {
                      setConfirmEmail(e.target.value);
                    }}
                    required
                    type="email"
                    value={confirmEmail}
                  />
                </label>
              </div>
            </fieldset>

            <fieldset className="field public-donation-preferences-fieldset">
              <legend>Preferences</legend>
              <div className="public-donation-preferences">
                <label className="public-donation-checkbox-label">
                  <input
                    checked={anonymous}
                    onChange={(e) => {
                      setAnonymous(e.target.checked);
                    }}
                    type="checkbox"
                  />
                  <span>Hide my name from public donor recognition</span>
                </label>
                <label className="public-donation-checkbox-label">
                  <input
                    checked={marketingConsent}
                    onChange={(e) => {
                      setMarketingConsent(e.target.checked);
                    }}
                    type="checkbox"
                  />
                  <span>I would like to receive updates about future events and programs</span>
                </label>
              </div>
            </fieldset>
          </div>

          <aside aria-label="Donation summary" className="public-donation-summary">
            <div className="public-donation-summary-card">
              <h3>Donation summary</h3>
              <div className="public-donation-summary-rows">
                <div className="public-donation-summary-row">
                  <span>Donation</span>
                  <strong>{money(amountCents)}</strong>
                </div>
                <div className="public-donation-summary-row">
                  <span>Processing fee</span>
                  <span>
                    {transactionFeeSettings.passFeeToDonor
                      ? money(feeCents)
                      : "Covered by the Organization"}
                  </span>
                </div>
                <hr className="public-donation-summary-divider" />
                <div className="public-donation-summary-row public-donation-summary-total">
                  <strong>Total</strong>
                  <strong>{money(amountCents + feeCents)}</strong>
                </div>
              </div>
              <button
                className="button button--primary public-donation-submit"
                disabled={busy}
                type="submit"
              >
                {busy ? "Completing donation…" : "Complete donation"}
              </button>
            </div>
          </aside>
        </div>
      </form>
    </section>
  );
}
