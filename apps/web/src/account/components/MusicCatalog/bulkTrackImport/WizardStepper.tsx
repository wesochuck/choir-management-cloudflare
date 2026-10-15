import type { TrackImportStep } from "./types";

interface StepConfig {
  readonly key: TrackImportStep;
  readonly label: string;
  readonly number: number;
}

const STEPS: readonly StepConfig[] = [
  { key: "scope_files", label: "Choose files", number: 1 },
  { key: "review", label: "Review matches", number: 2 },
  { key: "upload", label: "Confirm & upload", number: 3 },
  { key: "results", label: "Results", number: 4 },
];

function stepIndex(step: TrackImportStep): number {
  switch (step) {
    case "scope_files":
      return 0;
    case "review":
      return 1;
    case "upload":
      return 2;
    case "results":
      return 3;
  }
}

export function WizardStepper({ currentStep }: { readonly currentStep: TrackImportStep }) {
  const currentIndex = stepIndex(currentStep);

  return (
    <nav aria-label="Import progress" className="track-import-stepper">
      <ol className="track-import-stepper__list">
        {STEPS.map((s, idx) => {
          const isDone = idx < currentIndex;
          const isCurrent = idx === currentIndex;
          return (
            <li
              key={s.key}
              aria-current={isCurrent ? "step" : undefined}
              className={`track-import-stepper__item ${
                isCurrent ? "track-import-stepper__item--current" : ""
              } ${isDone ? "track-import-stepper__item--done" : ""}`}
            >
              <span className="track-import-stepper__circle">
                {isDone ? "✓" : String(s.number)}
              </span>
              <span className="track-import-stepper__label">{s.label}</span>
              {idx < STEPS.length - 1 ? (
                <span aria-hidden="true" className="track-import-stepper__connector" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
