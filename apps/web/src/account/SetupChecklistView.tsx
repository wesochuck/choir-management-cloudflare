import { setupStatusSchema, type SetupStatus } from "@choir/contracts";
import { useEffect, useState } from "react";

type CheckState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly setup: SetupStatus; readonly status: "ready" };

const allSteps = ["organization_info", "modules", "theme", "launch"] as const;
type SetupStep = (typeof allSteps)[number];

const stepGuidance: Record<
  SetupStep,
  { readonly action: string; readonly description: string; readonly href: string }
> = {
  organization_info: {
    action: "Complete organization info",
    description: "Enter the Organization name and hostname details in the setup wizard.",
    href: "/setup",
  },
  modules: {
    action: "Review modules",
    description: "Choose which people, events, and programs features this Organization uses.",
    href: "/admin/settings/modules",
  },
  theme: {
    action: "Set up theme",
    description: "Choose the colors members and the public pages will use.",
    href: "/setup",
  },
  launch: {
    action: "Launch Organization",
    description: "Review the remaining steps in the setup wizard, then make the Organization live.",
    href: "/setup",
  },
};

function stepLabel(step: SetupStep): string {
  switch (step) {
    case "organization_info":
      return "Organization Info";
    case "modules":
      return "Module Configuration";
    case "theme":
      return "Theme Setup";
    case "launch":
      return "Launch";
    default:
      return step;
  }
}

export function SetupChecklistView() {
  const [checkState, setCheckState] = useState<CheckState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/setup/status", { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load");
        const body: unknown = await response.json();
        const parsed = setupStatusSchema.safeParse(body);
        setCheckState(
          parsed.success ? { setup: parsed.data, status: "ready" } : { status: "error" },
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCheckState({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, []);

  if (checkState.status === "loading")
    return (
      <p className="notice notice--info" role="status">
        Loading setup status…
      </p>
    );
  if (checkState.status === "error")
    return (
      <p className="notice notice--error" role="alert">
        Setup status could not be loaded.
      </p>
    );

  const { setup } = checkState;
  const completedCount = allSteps.filter((step) => setup.completedSteps.includes(step)).length;

  return (
    <section className="panel" aria-label="Setup progress">
      <p>
        {completedCount} of {allSteps.length} steps completed.
      </p>
      {setup.launched && completedCount === allSteps.length ? (
        <p className="notice notice--success" role="status">
          Setup is complete. Your Organization is live.
        </p>
      ) : (
        <p className="notice notice--warning" role="status">
          {setup.launched
            ? "Your Organization is live, but one or more setup steps still need attention."
            : "Setup is not yet complete. Use the action beside each incomplete step to finish it."}
        </p>
      )}
      <ul className="account-list">
        {allSteps.map((step) => {
          const done = setup.completedSteps.includes(step);
          const guidance = stepGuidance[step];
          return (
            <li className="setup-checklist__item" key={step}>
              <div className="setup-checklist__details">
                <strong className={done ? "status-done" : "status-pending"}>
                  {done ? "✓" : "○"} {stepLabel(step)}
                </strong>
                <p>{done ? "This step is complete." : guidance.description}</p>
              </div>
              {!done ? (
                <a className="button button--secondary" href={guidance.href}>
                  {guidance.action}
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
