import {
  setupProgressRequestSchema,
  type SetupProgressRequest,
  type SetupStatus,
} from "@choir/contracts";
import { MODULE_DEFINITIONS } from "@choir/domain";
import { useEffect, useRef, useState } from "react";
import {
  completeSetup,
  getSetupStatus,
  saveSetupProgress,
  uploadPrivateOrganizationFile,
} from "../api";

import { SetupDataImportStep } from "./SetupDataImportStep";

type SetupState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly setup: SetupStatus; readonly status: "ready" };

type Step = "organization_info" | "modules" | "theme" | "data_import" | "launch";

const steps: readonly { readonly id: Step; readonly title: string }[] = [
  { id: "organization_info", title: "Organization Info" },
  { id: "modules", title: "Modules" },
  { id: "theme", title: "Theme" },
  { id: "data_import", title: "Import Data" },
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

// eslint-disable-next-line complexity -- SetupView coordinates multi-step setup wizard state and renderers.
export function SetupView() {
  const [setupState, setSetupState] = useState<SetupState>({ status: "loading" });
  const [currentStep, setCurrentStep] = useState<Step>("organization_info");
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [logoFileId, setLogoFileId] = useState<string | null>(null);
  const [physicalAddress, setPhysicalAddress] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const [modules, setModules] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(MODULE_DEFINITIONS.map((def) => [def.id, def.defaultEnabled])),
  );
  const [themePrimary, setThemePrimary] = useState("#1a1a2e");
  const [themeAccent, setThemeAccent] = useState("#e94560");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getSetupStatus(controller.signal)
      .then((setup) => {
        setSetupState({ setup, status: "ready" });
        if (setup.currentStep && isStep(setup.currentStep)) {
          setCurrentStep(setup.currentStep);
        } else if (setup.completedSteps.length > 0) {
          const next = nextUncompleted(setup.completedSteps);
          if (next) setCurrentStep(next);
        }
        setOrgName(setup.organizationName);
        if (setup.logoFileId) {
          setLogoFileId(setup.logoFileId);
        }
        if (setup.physicalAddress) {
          setPhysicalAddress(setup.physicalAddress);
        }
        if (setup.launched) {
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
      await saveSetupProgress(validated);
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
        stepData.logoFileId = logoFileId;
        stepData.physicalAddress = physicalAddress.trim() ? physicalAddress.trim() : null;
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
      await completeSetup();
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
              <div className="field">
                <label>Organization logo (optional)</label>
                <div
                  style={{
                    alignItems: "center",
                    display: "flex",
                    gap: "1rem",
                    marginTop: "0.5rem",
                  }}
                >
                  <div
                    style={{
                      alignItems: "center",
                      backgroundColor: "var(--color-surface-elevated, #f9f9fb)",
                      border: "1px solid var(--color-border, #dedde5)",
                      borderRadius: "6px",
                      display: "flex",
                      height: "64px",
                      justifyContent: "center",
                      overflow: "hidden",
                      padding: "4px",
                      width: "64px",
                    }}
                  >
                    {logoFileId ? (
                      <img
                        alt="Logo preview"
                        src={`/api/organization/files/${encodeURIComponent(logoFileId)}`}
                        style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }}
                      />
                    ) : (
                      <span
                        style={{
                          alignItems: "center",
                          backgroundColor: "var(--color-accent, #1b4d3e)",
                          borderRadius: "4px",
                          color: "#ffffff",
                          display: "flex",
                          fontSize: "1rem",
                          fontWeight: 700,
                          height: "36px",
                          justifyContent: "center",
                          width: "36px",
                        }}
                      >
                        {orgName
                          ? orgName
                              .split(/\s+/)
                              .map((p) => p[0])
                              .join("")
                              .slice(0, 2)
                              .toUpperCase()
                          : "CM"}
                      </span>
                    )}
                  </div>
                  <div>
                    <input
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      disabled={uploadingLogo || busy}
                      id="setup-org-logo-input"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        if (file.size > 5 * 1024 * 1024) {
                          setMessage("Logo file size must not exceed 5MB.");
                          if (logoInputRef.current) logoInputRef.current.value = "";
                          return;
                        }
                        setUploadingLogo(true);
                        setMessage(null);
                        void uploadPrivateOrganizationFile(file, file.name)
                          .then((res) => {
                            setLogoFileId(res.id);
                          })
                          .catch(() => {
                            setMessage("Logo could not be uploaded.");
                          })
                          .finally(() => {
                            setUploadingLogo(false);
                            if (logoInputRef.current) logoInputRef.current.value = "";
                          });
                      }}
                      ref={logoInputRef}
                      style={{ display: "none" }}
                      type="file"
                    />
                    <div className="button-row">
                      <button
                        className="button button--secondary button--sm"
                        disabled={uploadingLogo || busy}
                        onClick={() => {
                          logoInputRef.current?.click();
                        }}
                        type="button"
                      >
                        {uploadingLogo ? "Uploading…" : logoFileId ? "Change logo" : "Upload logo"}
                      </button>
                      {logoFileId ? (
                        <button
                          className="button button--secondary button--sm"
                          disabled={uploadingLogo || busy}
                          onClick={() => {
                            setLogoFileId(null);
                          }}
                          type="button"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
              <div className="field">
                <label htmlFor="setup-org-address">Physical postal address (optional)</label>
                <textarea
                  id="setup-org-address"
                  maxLength={2000}
                  onChange={(e) => {
                    setPhysicalAddress(e.target.value);
                  }}
                  placeholder="e.g. 123 Main St, Suite 400&#10;Seattle, WA 98101"
                  rows={3}
                  value={physicalAddress}
                />
                <p className="field-hint">
                  Your official mailing address or PO box. Displayed in outbound email footers for
                  CAN-SPAM and postal compliance.
                </p>
              </div>
            </div>
          </>
        ) : currentStep === "modules" ? (
          <>
            <h2 id="setup-step-heading">Modules</h2>
            <p>Enable the feature modules your Organization needs.</p>
            <div className="form-stack" style={{ gap: "0.75rem" }}>
              {MODULE_DEFINITIONS.map((def) => (
                <label key={def.id} className="checkbox-row">
                  <input
                    checked={modules[def.id] ?? def.defaultEnabled}
                    onChange={(e) => {
                      setModules((prev) => ({ ...prev, [def.id]: e.target.checked }));
                    }}
                    type="checkbox"
                  />
                  <div>
                    <strong>{def.label}</strong>
                    <span className="field-help" style={{ display: "block" }}>
                      {def.description}
                    </span>
                  </div>
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
        ) : currentStep === "data_import" ? (
          <SetupDataImportStep />
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
