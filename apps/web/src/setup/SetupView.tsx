import {
  setupProgressRequestSchema,
  setupStatusSchema,
  type SetupProgressRequest,
  type SetupStatus,
} from "@choir/contracts";
import { useEffect, useState } from "react";

type SetupState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly setup: SetupStatus; readonly status: "ready" };

type Step = "organization_info" | "modules" | "theme" | "launch";

const steps: readonly { readonly id: Step; readonly title: string }[] = [
  { id: "organization_info", title: "Organization Info" },
  { id: "modules", title: "Modules" },
  { id: "theme", title: "Theme" },
  { id: "launch", title: "Launch" },
];

function isStep(value: string): value is Step {
  return steps.some((s) => s.id === value);
}

function nextUncompleted(completedSteps: readonly string[]): Step | null {
  for (const step of steps) {
    if (!completedSteps.includes(step.id)) {
      return step.id;
    }
  }
  return null;
}

export function SetupView() {
  const [setupState, setSetupState] = useState<SetupState>({ status: "loading" });
  const [currentStep, setCurrentStep] = useState<Step>("organization_info");
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [modules, setModules] = useState<Record<string, boolean>>({
    people: true,
    events: true,
    programs: true,
  });
  const [themePrimary, setThemePrimary] = useState("#1a1a2e");
  const [themeAccent, setThemeAccent] = useState("#e94560");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/setup/status", { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load");
        const body: unknown = await response.json();
        const parsed = setupStatusSchema.safeParse(body);
        if (!parsed.success) throw new Error("Invalid response");
        setSetupState({ setup: parsed.data, status: "ready" });
        if (parsed.data.currentStep && isStep(parsed.data.currentStep)) {
          setCurrentStep(parsed.data.currentStep);
        } else if (parsed.data.completedSteps.length > 0) {
          const next = nextUncompleted(parsed.data.completedSteps);
          if (next) setCurrentStep(next);
        }
        setOrgName(parsed.data.organizationName);
        if (parsed.data.launched && parsed.data.completedSteps.length >= steps.length) {
          setCompleted(true);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setSetupState({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, []);

  async function saveProgress(step: string, data?: Record<string, unknown>) {
    setMessage(null);
    try {
      const body: SetupProgressRequest = { step, data };
      const validated = setupProgressRequestSchema.parse(body);
      const response = await fetch("/api/setup/progress", {
        body: JSON.stringify(validated),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("Failed to save");
    } catch {
      setMessage("Progress could not be saved.");
    }
  }

  async function handleNext() {
    setBusy(true);
    setMessage(null);
    try {
      const stepData: Record<string, unknown> = {};
      if (currentStep === "organization_info") {
        stepData.name = orgName;
        stepData.slug = orgSlug;
      } else if (currentStep === "modules") {
        Object.assign(stepData, modules);
      } else if (currentStep === "theme") {
        stepData.primaryColor = themePrimary;
        stepData.accentColor = themeAccent;
      }
      await saveProgress(currentStep, stepData);
      const currentIndex = steps.findIndex((s) => s.id === currentStep);
      const nextStep =
        currentIndex >= 0 && currentIndex < steps.length - 1 ? steps[currentIndex + 1] : null;
      if (nextStep) {
        setCurrentStep(nextStep.id);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleLaunch() {
    setBusy(true);
    setMessage(null);
    try {
      await saveProgress("launch");
      const response = await fetch("/api/setup/complete", {
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("Failed to complete");
      setCompleted(true);
    } catch {
      setMessage("Setup could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  function goBack() {
    const currentIndex = steps.findIndex((s) => s.id === currentStep);
    if (currentIndex > 0) {
      const prev = steps[currentIndex - 1];
      if (prev) setCurrentStep(prev.id);
    }
  }

  if (setupState.status === "loading") {
    return (
      <p className="notice notice--info" role="status">
        Loading setup…
      </p>
    );
  }
  if (setupState.status === "error") {
    return (
      <p className="notice notice--error" role="alert">
        Setup status could not be loaded.
      </p>
    );
  }
  if (completed) {
    return (
      <main className="account-layout setup-wizard">
        <div className="account-heading">
          <h1>Setup complete</h1>
        </div>
        <p>Your Organization is ready. Visit the dashboard to start managing.</p>
        <a className="button button--primary" href="/account/dashboard">
          Go to dashboard
        </a>
      </main>
    );
  }

  const currentIndex = steps.findIndex((s) => s.id === currentStep);
  const progressPercent = ((currentIndex + 1) / steps.length) * 100;

  return (
    <main className="account-layout setup-wizard">
      <div className="account-heading">
        <p className="eyebrow">Setup wizard</p>
        <h1>Welcome to your Organization</h1>
      </div>

      <div
        className="progress-bar"
        role="progressbar"
        aria-valuenow={progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="progress-bar__fill" style={{ width: `${String(progressPercent)}%` }} />
      </div>

      {message ? (
        <p className="notice notice--info" role="status">
          {message}
        </p>
      ) : null}

      <section className="panel" aria-labelledby="setup-step-heading">
        {currentStep === "organization_info" ? (
          <>
            <h2 id="setup-step-heading">Organization Info</h2>
            <div className="form-stack">
              <div className="field">
                <label htmlFor="setup-org-name">Organization name</label>
                <input
                  id="setup-org-name"
                  maxLength={120}
                  onChange={(e) => {
                    setOrgName(e.target.value);
                  }}
                  value={orgName}
                />
              </div>
              <div className="field">
                <label htmlFor="setup-org-slug">Slug</label>
                <input
                  id="setup-org-slug"
                  maxLength={63}
                  onChange={(e) => {
                    setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                  }}
                  value={orgSlug}
                />
              </div>
            </div>
          </>
        ) : currentStep === "modules" ? (
          <>
            <h2 id="setup-step-heading">Modules</h2>
            <p>Enable the modules your Organization needs.</p>
            <div className="form-stack">
              {Object.entries(modules).map(([key, enabled]) => (
                <label key={key} className="checkbox-label">
                  <input
                    checked={enabled}
                    onChange={(e) => {
                      setModules((prev) => ({ ...prev, [key]: e.target.checked }));
                    }}
                    type="checkbox"
                  />
                  {key.charAt(0).toUpperCase() + key.slice(1)}
                </label>
              ))}
            </div>
          </>
        ) : currentStep === "theme" ? (
          <>
            <h2 id="setup-step-heading">Theme</h2>
            <div className="form-stack">
              <div className="field">
                <label htmlFor="setup-theme-primary">Primary color</label>
                <input
                  id="setup-theme-primary"
                  onChange={(e) => {
                    setThemePrimary(e.target.value);
                  }}
                  type="color"
                  value={themePrimary}
                />
              </div>
              <div className="field">
                <label htmlFor="setup-theme-accent">Accent color</label>
                <input
                  id="setup-theme-accent"
                  onChange={(e) => {
                    setThemeAccent(e.target.value);
                  }}
                  type="color"
                  value={themeAccent}
                />
              </div>
            </div>
          </>
        ) : (
          <>
            <h2 id="setup-step-heading">Launch</h2>
            <p>Your Organization is configured and ready to launch.</p>
          </>
        )}

        <div className="form-actions">
          {currentStep === "launch" ? (
            <button
              className="button button--primary"
              disabled={busy}
              onClick={() => void handleLaunch()}
              type="button"
            >
              {busy ? "Launching…" : "Launch Organization"}
            </button>
          ) : (
            <button
              className="button button--primary"
              disabled={busy}
              onClick={() => void handleNext()}
              type="button"
            >
              {busy ? "Saving…" : "Continue"}
            </button>
          )}
          {currentIndex > 0 ? (
            <button
              className="button button--secondary"
              disabled={busy}
              onClick={goBack}
              type="button"
            >
              Back
            </button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
