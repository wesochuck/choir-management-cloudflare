import { setupStatusSchema, type SetupStatus } from "@choir/contracts";
import { useEffect, useState } from "react";

type CheckState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly setup: SetupStatus; readonly status: "ready" };

const allSteps = ["organization_info", "modules", "theme", "launch"];

function stepLabel(step: string): string {
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
      {setup.launched ? (
        <p className="notice notice--success" role="status">
          Setup is complete. Your Organization is live.
        </p>
      ) : (
        <p className="notice notice--info" role="status">
          Setup is not yet complete. <a href="/setup">Continue setup</a>
        </p>
      )}
      <ul className="account-list">
        {allSteps.map((step) => {
          const done = setup.completedSteps.includes(step);
          return (
            <li key={step}>
              <span className={done ? "status-done" : "status-pending"}>
                {done ? "✓" : "○"} {stepLabel(step)}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
