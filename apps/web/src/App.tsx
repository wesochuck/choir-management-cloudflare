import { healthResponseSchema } from "@choir/contracts";
import { useEffect, useState } from "react";

type ServiceState = "checking" | "offline" | "ready";

const moduleCards = [
  {
    description: "Profiles, invitations, voice parts, directory preferences, seasons, and dues.",
    title: "People",
  },
  {
    description: "Performances, rehearsals, RSVPs, attendance, calendars, reports, and seating.",
    title: "Events",
  },
  {
    description: "Music, resources, messages, polls, auditions, tickets, and donations.",
    title: "Programs",
  },
] as const;

export function App() {
  const [serviceState, setServiceState] = useState<ServiceState>("checking");

  useEffect(() => {
    const abortController = new AbortController();

    async function checkService() {
      try {
        const response = await fetch("/api/health", {
          headers: { accept: "application/json" },
          signal: abortController.signal,
        });
        const body: unknown = await response.json();
        setServiceState(
          response.ok && healthResponseSchema.safeParse(body).success ? "ready" : "offline",
        );
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setServiceState("offline");
      }
    }

    void checkService();
    return () => {
      abortController.abort();
    };
  }, []);

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Choir Management home">
          <span className="brand-mark" aria-hidden="true">
            CM
          </span>
          <span>Choir Management</span>
        </a>
        <span className={`service-status service-status--${serviceState}`} role="status">
          <span aria-hidden="true" className="service-status__dot" />
          {serviceState === "checking"
            ? "Checking service"
            : serviceState === "ready"
              ? "Staging ready"
              : "Shell preview"}
        </span>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero__copy">
            <p className="eyebrow">The next home for your Organization</p>
            <h1 id="hero-title">One calm place to keep a choir moving together.</h1>
            <p className="hero__lede">
              The Cloudflare rebuild is taking shape as a secure, accessible home for every
              rehearsal, performance, person, and public experience.
            </p>
            <div className="hero__actions">
              <a className="button button--primary" href="#foundation">
                Explore the foundation
              </a>
              <a className="button button--secondary" href="/api/health">
                View service health
              </a>
            </div>
          </div>
          <div className="hero__art" aria-label="Abstract layered choir risers">
            <div className="voice voice--one">S</div>
            <div className="voice voice--two">A</div>
            <div className="voice voice--three">T</div>
            <div className="voice voice--four">B</div>
          </div>
        </section>

        <section className="foundation" id="foundation" aria-labelledby="foundation-title">
          <div className="section-heading">
            <p className="eyebrow">Foundation first</p>
            <h2 id="foundation-title">Built around each Organization.</h2>
            <p>
              Operational data stays inside its Organization boundary while the public site remains
              fast at the edge.
            </p>
          </div>
          <div className="module-grid">
            {moduleCards.map((module, index) => (
              <article className="module-card" key={module.title}>
                <span className="module-card__index" aria-hidden="true">
                  0{index + 1}
                </span>
                <h3>{module.title}</h3>
                <p>{module.description}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer>
        <p>Permanent staging · no production launch</p>
      </footer>
    </div>
  );
}
