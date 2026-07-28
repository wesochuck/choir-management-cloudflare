import type { DonationSettings } from "@choir/contracts";
import { useEffect, useState, type SyntheticEvent } from "react";

import { getPublicDonationSettings } from "../auth/api";

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

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { currency: "USD", style: "currency" }).format(
    cents / 100,
  );
}

export function PublicDonationView() {
  const [settings, setSettings] = useState<DonationSettings>(DEFAULT_SETTINGS);
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
  const [checkoutRequestId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    const controller = new AbortController();
    getPublicDonationSettings(controller.signal)
      .then((loaded) => {
        setSettings(loaded);
        const first = loaded.levels[0];
        if (first) {
          setSelectedLevelId(first.id);
          setAmountCents(first.amountCents);
        } else {
          setSelectedLevelId("custom");
        }
      })
      .catch(() => {
        // Defaults keep the public form available while settings are unavailable.
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
      const response = await fetch("/api/checkout/create-donation-session", {
        body: JSON.stringify({
          amountCents,
          anonymous,
          buyerEmail: buyerEmail.trim(),
          buyerName: buyerName.trim(),
          checkoutRequestId,
          marketingConsent,
          tributeName,
          tributeNotifyEmail,
          tributeType,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        const body: unknown = await response.json();
        const message =
          typeof body === "object" &&
          body !== null &&
          "message" in body &&
          typeof body.message === "string"
            ? body.message
            : "The donation could not be completed.";
        throw new Error(message);
      }
      const body: unknown = await response.json();
      const url =
        typeof body === "object" && body !== null && "url" in body && typeof body.url === "string"
          ? body.url
          : "/donate/success";
      window.location.assign(url);
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : "The donation could not be completed.");
      setBusy(false);
    }
  }

  return (
    <section className="public-section public-section--narrow">
      <h1>{settings.buttonText}</h1>
      <p>{settings.description}</p>
      {settingsLoading ? <p className="notice notice--info">Loading donation options…</p> : null}
      <form className="panel form-stack" onSubmit={(formEvent) => void submit(formEvent)}>
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        <fieldset className="field">
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
            <label className="field">
              Custom amount
              <input
                maxLength={10}
                min="0"
                placeholder="0.00"
                step="0.01"
                type="text"
                value={customAmount}
                onChange={(e) => {
                  handleCustomChange(e.target.value);
                }}
              />
            </label>
          ) : null}
        </fieldset>
        <fieldset className="field">
          <legend>Tribute</legend>
          <label>
            <input
              checked={tributeType === "none"}
              onChange={() => {
                setTributeType("none");
              }}
              type="radio"
              name="tributeType"
            />{" "}
            None
          </label>
          <label>
            <input
              checked={tributeType === "honor"}
              onChange={() => {
                setTributeType("honor");
              }}
              type="radio"
              name="tributeType"
            />{" "}
            In Honor Of
          </label>
          <label>
            <input
              checked={tributeType === "memory"}
              onChange={() => {
                setTributeType("memory");
              }}
              type="radio"
              name="tributeType"
            />{" "}
            In Memory Of
          </label>
          <label>
            <input
              checked={tributeType === "anonymous"}
              onChange={() => {
                setTributeType("anonymous");
              }}
              type="radio"
              name="tributeType"
            />{" "}
            Anonymous
          </label>
          {tributeType === "honor" || tributeType === "memory" ? (
            <>
              <label className="field">
                {tributeType === "honor" ? "Honoree name" : "Person to memorialize"}
                <input
                  maxLength={500}
                  required
                  value={tributeName}
                  onChange={(e) => {
                    setTributeName(e.target.value);
                  }}
                />
              </label>
              <label className="field">
                Notification email (optional)
                <input
                  maxLength={320}
                  type="email"
                  value={tributeNotifyEmail}
                  onChange={(e) => {
                    setTributeNotifyEmail(e.target.value);
                  }}
                />
              </label>
            </>
          ) : null}
        </fieldset>
        <label>
          <input
            checked={anonymous}
            type="checkbox"
            onChange={(e) => {
              setAnonymous(e.target.checked);
            }}
          />{" "}
          Show my donation as anonymous
        </label>
        <label>
          <input
            checked={marketingConsent}
            type="checkbox"
            onChange={(e) => {
              setMarketingConsent(e.target.checked);
            }}
          />{" "}
          I would like to receive updates about future events and programs
        </label>
        <fieldset className="field">
          <legend>Your information</legend>
          <label className="field">
            Name
            <input
              required
              maxLength={200}
              value={buyerName}
              onChange={(e) => {
                setBuyerName(e.target.value);
              }}
            />
          </label>
          <label className="field">
            Email
            <input
              required
              type="email"
              value={buyerEmail}
              onChange={(e) => {
                setBuyerEmail(e.target.value);
              }}
            />
          </label>
          <label className="field">
            Confirm email
            <input
              required
              type="email"
              value={confirmEmail}
              onChange={(e) => {
                setConfirmEmail(e.target.value);
              }}
            />
          </label>
        </fieldset>
        <p>
          <strong>Total: {money(amountCents)}</strong>
        </p>
        <button className="button button--primary" disabled={busy} type="submit">
          {busy ? "Completing donation…" : "Complete donation"}
        </button>
      </form>
    </section>
  );
}
