import type { NonprofitComplianceTask } from "@choir/contracts";

export function ArchivedTasks({
  onRestore,
  operationBusy,
  tasks,
}: {
  readonly onRestore: (task: NonprofitComplianceTask) => void;
  readonly operationBusy: boolean;
  readonly tasks: readonly NonprofitComplianceTask[];
}): React.JSX.Element | null {
  if (tasks.length === 0) return null;
  return (
    <div style={{ marginTop: "1.5rem" }}>
      <h3 style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>
        Archived reminders ({String(tasks.length)})
      </h3>
      <div style={{ display: "grid", gap: "0.75rem" }}>
        {tasks.map((task) => (
          <div
            key={task.id}
            className="surface-card"
            style={{
              border: "1px dashed var(--color-border-subtle)",
              borderRadius: "var(--radius-md)",
              opacity: 0.9,
              padding: "0.75rem 1rem",
            }}
          >
            <div
              style={{
                alignItems: "center",
                display: "flex",
                gap: "0.5rem",
                justifyContent: "space-between",
              }}
            >
              <span>
                <strong>{task.title}</strong>{" "}
                <span className="field__hint">Archived · history retained · reminders halted</span>
              </span>
              <button
                className="button button--secondary button--sm"
                disabled={operationBusy}
                onClick={() => {
                  onRestore(task);
                }}
                type="button"
              >
                Restore
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
