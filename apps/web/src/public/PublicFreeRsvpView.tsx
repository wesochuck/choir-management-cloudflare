import { useState } from "react";

export function PublicFreeRsvpView() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRsvp(rsvp: "Yes" | "No" | "Pending") {
    setError(null);
    try {
      const response = await fetch("/api/public/rsvp", {
        body: JSON.stringify({ email, name, rsvp }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        setError("RSVP could not be submitted.");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("RSVP could not be submitted.");
    }
  }

  if (submitted) {
    return (
      <main>
        <section className="auth-card" aria-labelledby="rsvp-submitted-title">
          <h1 id="rsvp-submitted-title">RSVP received</h1>
          <p>Thank you, {name}. Your response has been recorded.</p>
        </section>
      </main>
    );
  }

  return (
    <main>
      <section className="auth-card" aria-labelledby="free-rsvp-title">
        <h1 id="free-rsvp-title">Free RSVP</h1>
        <div className="form-group">
          <label htmlFor="rsvp-name">Name</label>
          <input
            id="rsvp-name"
            onChange={(e) => {
              setName(e.target.value);
            }}
            type="text"
            value={name}
          />
        </div>
        <div className="form-group">
          <label htmlFor="rsvp-email">Email</label>
          <input
            id="rsvp-email"
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            type="email"
            value={email}
          />
        </div>
        {error ? (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="hero__actions">
          <button
            className="button button--primary"
            disabled={!name || !email}
            onClick={() => void handleRsvp("Yes")}
            type="button"
          >
            Yes
          </button>
          <button
            className="button button--secondary"
            disabled={!name || !email}
            onClick={() => void handleRsvp("No")}
            type="button"
          >
            No
          </button>
          <button
            className="button button--secondary"
            disabled={!name || !email}
            onClick={() => void handleRsvp("Pending")}
            type="button"
          >
            Pending
          </button>
        </div>
      </section>
    </main>
  );
}
