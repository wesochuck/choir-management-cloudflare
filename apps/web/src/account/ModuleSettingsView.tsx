import { moduleStatesResponseSchema, type ModuleState } from "@choir/contracts";
import { useEffect, useMemo, useState } from "react";

type ModulesState =
  | { readonly status: "error" }
  | { readonly status: "loading" }
  | { readonly modules: readonly ModuleState[]; readonly status: "ready" };

const categoryLabels: Record<string, string> = {
  people: "People",
  events: "Events",
  content: "Music & Content",
  finance: "Communications & Finance",
  insights: "Insights & Reports",
};

const categoryOrder = ["people", "events", "content", "finance", "insights"];

export function ModuleSettingsView() {
  const [modulesState, setModulesState] = useState<ModulesState>({ status: "loading" });
  const [busyModuleId, setBusyModuleId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/organization/module-state", {
      credentials: "same-origin",
      signal: controller.signal,
    })
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
    setBusyModuleId(moduleId);
    setMessage(null);
    setErrorMessage(null);
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
      const mod =
        modulesState.status === "ready"
          ? modulesState.modules.find((m) => m.id === moduleId)
          : null;
      const label = mod?.label ?? moduleId;
      setMessage(`${label} ${enabled ? "enabled" : "disabled"}.`);
    } catch {
      setErrorMessage("Module could not be updated. Please try again.");
    } finally {
      setBusyModuleId(null);
    }
  }

  const groupedModules = useMemo(() => {
    if (modulesState.status !== "ready") return [];
    const groups: { category: string; label: string; modules: ModuleState[] }[] = [];
    const categoryMap = new Map<string, ModuleState[]>();

    for (const mod of modulesState.modules) {
      const cat = mod.category ?? "other";
      const existing = categoryMap.get(cat);
      if (existing) {
        existing.push(mod);
      } else {
        categoryMap.set(cat, [mod]);
      }
    }

    for (const cat of categoryOrder) {
      const items = categoryMap.get(cat);
      if (items && items.length > 0) {
        groups.push({
          category: cat,
          label: categoryLabels[cat] ?? cat,
          modules: items,
        });
        categoryMap.delete(cat);
      }
    }

    for (const [cat, items] of categoryMap) {
      groups.push({
        category: cat,
        label: categoryLabels[cat] ?? cat,
        modules: items,
      });
    }

    return groups;
  }, [modulesState]);

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
    <section className="panel" aria-label="Module settings">
      <div className="section-heading">
        <div>
          <h2>Organization Modules</h2>
          <p className="section-description">
            Customize which features and navigation sections are active for your organization.
          </p>
        </div>
      </div>

      {message ? (
        <p className="notice notice--info" role="status">
          {message}
        </p>
      ) : null}
      {errorMessage ? (
        <p className="notice notice--error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {groupedModules.length === 0 ? (
        <p>No modules configured.</p>
      ) : (
        <div className="form-stack module-settings-groups">
          {groupedModules.map((group) => (
            <fieldset className="panel module-settings-group" key={group.category}>
              <legend>
                <strong>{group.label}</strong>
              </legend>
              <div className="form-stack module-settings-group__modules">
                {group.modules.map((mod) => (
                  <label className="checkbox-row" key={mod.id}>
                    <input
                      checked={mod.enabled}
                      disabled={busyModuleId !== null}
                      onChange={(e) => {
                        void toggleModule(mod.id, e.target.checked);
                      }}
                      type="checkbox"
                    />
                    <div>
                      <strong>{mod.label ?? mod.id}</strong>
                      {mod.description ? (
                        <span className="field-help" style={{ display: "block" }}>
                          {mod.description}
                        </span>
                      ) : null}
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      )}
    </section>
  );
}
