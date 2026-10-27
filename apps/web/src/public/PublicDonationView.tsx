import type {
  DonationSettings,
  DonationTributeInput,
  TransactionFeeSettings,
} from "@choir/contracts";
import { transactionProcessingFeeCents } from "@choir/domain";
import { useEffect, useState, type SyntheticEvent } from "react";

import {
  checkoutPublicDonation,
  getPublicDonationSettings,
  getPublicTransactionFeeSettings,
  uploadPublicSponsorArtwork,
} from "../api";
import { shouldStartNewDonationCheckoutAttempt } from "./checkoutAttempt";
import { formatDonationMoney } from "./donationFormat";
import { PublicCopy } from "./PublicCopy";

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
  thankYouMessage:
    "Your support helps us continue our programs and share our music with the community.",
};

const DEFAULT_TRANSACTION_FEE_SETTINGS: TransactionFeeSettings = {
  fixedCents: 30,
  passFeeToDonor: false,
  percentage: 2.9,
};

const TRIBUTE_OPTIONS: readonly {
  readonly label: string;
  readonly value: DonationTributeInput;
}[] = [
  { label: "No tribute", value: "none" },
  { label: "In honor of", value: "honor" },
  { label: "In memory of", value: "memory" },
];

// eslint-disable-next-line complexity -- PublicDonationView coordinates donation levels, custom amount, tribute options, fees, and checkout.
export function PublicDonationView({ heading }: { readonly heading?: string | undefined }) {
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
  const [sponsorName, setSponsorName] = useState("");
  const [uploadedArtwork, setUploadedArtwork] = useState<{
    readonly fileId: string;
    readonly fileName: string;
    readonly sizeBytes: number;
  } | null>(null);
  const [artworkUploading, setArtworkUploading] = useState(false);
  const [artworkError, setArtworkError] = useState<string | null>(null);
  const [tributeType, setTributeType] = useState<DonationTributeInput>("none");
  const [tributeName, setTributeName] = useState("");
  const [tributeNotifyEmail, setTributeNotifyEmail] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkoutRequestId, setCheckoutRequestId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      getPublicDonationSettings(controller.signal),
      getPublicTransactionFeeSettings(controller.signal),
    ])
      .then(([loaded, feeSettings]) => {
        const levels = [...loaded.levels].sort((a, b) => a.amountCents - b.amountCents);
        setSettings({ ...loaded, levels });
        setTransactionFeeSettings(feeSettings);
        const first = levels[0];
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

  const selectedLevel = !useCustom
    ? settings.levels.find((level) => level.id === selectedLevelId)
    : undefined;
  const isAdLevel = Boolean(selectedLevel?.includesProgramAd);

  function selectLevel(levelId: string, cents: number): void {
    setSelectedLevelId(levelId);
    setUseCustom(false);
    setAmountCents(cents);
    const targetLevel = settings.levels.find((l) => l.id === levelId);
    if (!targetLevel?.includesProgramAd) {
      setUploadedArtwork(null);
      setArtworkError(null);
    }
  }

  const feeCents = transactionFeeSettings.passFeeToDonor
    ? transactionProcessingFeeCents(amountCents, transactionFeeSettings)
    : 0;

  function handleCustomChange(value: string) {
    setCustomAmount(value);
    setUseCustom(true);
    setUploadedArtwork(null);
    setArtworkError(null);
    const parsed = Number(value.replace(/[^0-9.]/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) {
      setAmountCents(Math.round(parsed * 100));
    }
  }

  async function handleArtworkFileSelected(file: File): Promise<void> {
    if (!selectedLevel?.id) return;
    if (file.size > 20 * 1024 * 1024) {
      setArtworkError("Artwork file must be at most 20 MB.");
      return;
    }
    const lowerType = file.type.toLowerCase();
    if (
      lowerType !== "application/pdf" &&
      lowerType !== "image/png" &&
      lowerType !== "image/jpeg" &&
      lowerType !== "image/jpg"
    ) {
      setArtworkError("Artwork must be a PDF, PNG, or JPEG file.");
      return;
    }
    setArtworkError(null);
    setArtworkUploading(true);
    try {
      const uploaded = await uploadPublicSponsorArtwork(file, selectedLevel.id, checkoutRequestId);
      setUploadedArtwork({
        fileId: uploaded.fileId,
        fileName: uploaded.fileName,
        sizeBytes: uploaded.sizeBytes,
      });
    } catch (err: unknown) {
      setArtworkError(
        err instanceof Error
          ? err.message
          : "The artwork file could not be uploaded. Please try again or send later.",
      );
      setUploadedArtwork(null);
    } finally {
      setArtworkUploading(false);
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
        artworkFileId: isAdLevel ? (uploadedArtwork?.fileId ?? null) : null,
        buyerEmail: buyerEmail.trim(),
        buyerName: buyerName.trim(),
        checkoutRequestId,
        levelId: !useCustom ? selectedLevelId : null,
        marketingConsent,
        sponsorName: isAdLevel ? sponsorName.trim() || buyerName.trim() : undefined,
        tributeName,
        tributeNotifyEmail,
        tributeType,
      });
      window.location.assign(result.url || "/donate/success");
    } catch (failure: unknown) {
      if (shouldStartNewDonationCheckoutAttempt(failure)) {
        setCheckoutRequestId(crypto.randomUUID());
      }
      setError(failure instanceof Error ? failure.message : "The donation could not be completed.");
      setBusy(false);
    }
  }

  return (
    <section className="public-section public-donation-section">
      <h1>{heading ?? settings.buttonText}</h1>
      <PublicCopy text={settings.description} />
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
                <strong>{formatDonationMoney(level.amountCents)}</strong>
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
            {isAdLevel && selectedLevel ? (
              <fieldset className="field public-donation-sponsor-fieldset" id="sponsor-section">
                <legend>Program advertisement</legend>
                {selectedLevel.artworkInstructions ? (
                  <div className="public-donation-artwork-instructions notice notice--info">
                    <p className="public-donation-artwork-instructions-title">
                      Artwork specifications:
                    </p>
                    <p>{selectedLevel.artworkInstructions}</p>
                  </div>
                ) : null}
                <label className="field">
                  Sponsor or business name
                  <input
                    maxLength={200}
                    onChange={(e) => {
                      setSponsorName(e.target.value);
                    }}
                    placeholder="Defaults to donor name if blank"
                    value={sponsorName}
                  />
                </label>
                <div className="public-donation-artwork-field">
                  <span className="field-label">Print-ready ad artwork</span>
                  {uploadedArtwork ? (
                    <div className="public-donation-file-chip">
                      <div className="public-donation-file-chip__details">
                        <strong className="public-donation-file-chip__name">
                          {uploadedArtwork.fileName}
                        </strong>
                        <span className="public-donation-file-chip__size">
                          {Math.round(uploadedArtwork.sizeBytes / 1024)} KB
                        </span>
                      </div>
                      <div className="public-donation-file-chip__actions">
                        <label className="button button--secondary button--small public-donation-file-replace-btn">
                          Replace
                          <input
                            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                            className="sr-only"
                            disabled={busy || artworkUploading}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) void handleArtworkFileSelected(file);
                            }}
                            type="file"
                          />
                        </label>
                        <button
                          className="button button--subtle button--small"
                          disabled={busy || artworkUploading}
                          onClick={() => {
                            setUploadedArtwork(null);
                            setArtworkError(null);
                          }}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="public-donation-artwork-picker">
                      <label className="public-donation-artwork-dropzone">
                        <input
                          accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
                          className="sr-only"
                          disabled={busy || artworkUploading}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleArtworkFileSelected(file);
                          }}
                          type="file"
                        />
                        <span className="public-donation-artwork-dropzone__prompt">
                          {artworkUploading ? (
                            <span>Uploading artwork…</span>
                          ) : (
                            <>
                              <strong>Choose an artwork file</strong> or drag and drop
                              <small>PDF, PNG, or JPG up to 20 MB</small>
                            </>
                          )}
                        </span>
                      </label>
                      <p className="public-donation-artwork-later-hint">
                        <em>Optional:</em> Don’t have artwork ready? You can complete checkout now
                        and submit your artwork later using the link in your receipt.
                      </p>
                    </div>
                  )}
                  {artworkError ? (
                    <p className="notice notice--error" role="alert">
                      {artworkError}
                    </p>
                  ) : null}
                </div>
              </fieldset>
            ) : null}

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
              <div className="public-donation-preferences choice-group">
                <label className="choice-field choice-field--large public-donation-checkbox-label">
                  <input
                    checked={anonymous}
                    onChange={(e) => {
                      setAnonymous(e.target.checked);
                    }}
                    type="checkbox"
                  />
                  <span className="choice-field__content">
                    Hide my name from public donor recognition
                  </span>
                </label>
                <label className="choice-field choice-field--large public-donation-checkbox-label">
                  <input
                    checked={marketingConsent}
                    onChange={(e) => {
                      setMarketingConsent(e.target.checked);
                    }}
                    type="checkbox"
                  />
                  <span className="choice-field__content">
                    I would like to receive updates about future events and programs
                  </span>
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
                  <strong>{formatDonationMoney(amountCents)}</strong>
                </div>
                {isAdLevel ? (
                  <div className="public-donation-summary-row">
                    <span>Program ad</span>
                    <span>{uploadedArtwork ? "Artwork attached" : "Send artwork later"}</span>
                  </div>
                ) : null}
                <div className="public-donation-summary-row">
                  <span>Processing fee</span>
                  <span>
                    {transactionFeeSettings.passFeeToDonor
                      ? formatDonationMoney(feeCents)
                      : "Covered by the Organization"}
                  </span>
                </div>
                <hr className="public-donation-summary-divider" />
                <div className="public-donation-summary-row public-donation-summary-total">
                  <strong>Total</strong>
                  <strong>{formatDonationMoney(amountCents + feeCents)}</strong>
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
