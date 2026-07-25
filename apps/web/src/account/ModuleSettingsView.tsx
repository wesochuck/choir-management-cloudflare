import { moduleStatesResponseSchema, type ModuleState } from "@choir/contracts";
import { useEffect, useState } from "react";

type ModulesState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly modules: readonly ModuleState[]; readonly status: "ready" };

export function ModuleSettingsView() {
  const [modulesState, setModulesState] = useState<ModulesState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/modules/state", { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load");
        const body: unknown = await response.json();
        const parsed = moduleStatesResponseSchema.safeParse(body);
        setModulesState(
          parsed.success ? { modules: parsed.data.modules, status: "ready" } : { status: "error" },
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setModulesState({ status: "error" });
        }
      });
    return () => {
      controller.abort();
    };
  }, []);

  async function toggleModule(moduleId: string, enabled: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/setup/progress", {
        body: JSON.stringify({ step: "modules", data: { [moduleId]: enabled } }),
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) throw new Error("Failed to update");
      setModulesState((current) =>
        current.status === "ready"
          ? {
              modules: current.modules.map((m) => (m.id === moduleId ? { ...m, enabled } : m)),
              status: "ready",
            }
          : current,
      );
      setMessage(`Module ${enabled ? "enabled" : "disabled"}.`);
    } catch {
      setMessage("Module could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  if (modulesState.status === "loading")
    return (
      <p className="notice notice--info" role="status">
        Loading modules…
      </p>
    );
  if (modulesState.status === "error")
    return (
      <p className="notice notice--error" role="alert">
        Modules could not be loaded.
      </p>
    );

  return (
    <section className="panel" aria-labelledby="module-settings-heading">
      <p className="eyebrow">Manager tools</p>
      <h2 id="module-settings-heading">Module Settings</h2>
      {message ? (
        <p className="notice notice--info" role="status">
          {message}
        </p>
      ) : null}
      {modulesState.modules.length === 0 ? (
        <p>No modules configured.</p>
      ) : (
        <div className="form-stack">
          {modulesState.modules.map((mod) => (
            <label key={mod.id} className="checkbox-label">
              <input
                checked={mod.enabled}
                disabled={busy}
                onChange={(e) => {
                  void toggleModule(mod.id, e.target.checked);
                }}
                type="checkbox"
              />
              {mod.id.charAt(0).toUpperCase() + mod.id.slice(1)}
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
