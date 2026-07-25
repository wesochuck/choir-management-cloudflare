import { useState, type SyntheticEvent } from "react";

const PRESETS = [2500, 5000, 10000, 25000, 50000];

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { currency: "USD", style: "currency" }).format(
    cents / 100,
  );
}

type LoadState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly status: "ready" };

export function PublicDonationView() {
  const [state] = useState<LoadState>({ status: "ready" });
  const [buyerName, setBuyerName] = useState("");
  const [buyerEmail, setBuyerEmail] = useState("");
  const [confirmEmail, setConfirmEmail] = useState("");
  const [amountCents, setAmountCents] = useState(2500);
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

  function selectPreset(cents: number) {
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
        typeof body === "object" &&
        body !== null &&
        "url" in body &&
        typeof body.url === "string"
          ? body.url
          : "/donate/success";
      window.location.assign(url);
    } catch (failure: unknown) {
      setError(
        failure instanceof Error ? failure.message : "The donation could not be completed.",
      );
      setBusy(false);
    }
  }

  if (state.status === "loading" || state.status === "error") return null;

  return (
    <section className="public-section public-section--narrow">
      <h1>Make a Donation</h1>
      <p>Your contribution supports our mission to share music with our community.</p>
      <form className="panel form-stack" onSubmit={(formEvent) => void submit(formEvent)}>
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        <fieldset className="field">
          <legend>Select an amount</legend>
          <div className="form-grid form-grid--five">
            {PRESETS.map((cents) => (
              <button
                className={`button ${!useCustom && amountCents === cents ? "button--primary" : "button--secondary"}`}
                disabled={busy}
                key={cents}
                onClick={() => {
                  selectPreset(cents);
                }}
                type="button"
              >
                {money(cents)}
              </button>
            ))}
          </div>
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
