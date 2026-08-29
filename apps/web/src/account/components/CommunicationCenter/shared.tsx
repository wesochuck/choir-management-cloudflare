import type { OrganizationRosterConfiguration } from "@choir/contracts";

export function CommunicationSectionPicker({
  configuration,
  onChange,
  value,
}: {
  readonly configuration: OrganizationRosterConfiguration;
  readonly onChange: (sections: readonly string[]) => void;
  readonly value: string;
}) {
  const sections = configuration.sections.filter(({ trackOnly }) => !trackOnly);
  const selected = value
    .split(",")
    .map((section) => section.trim())
    .filter((section) => sections.some(({ code }) => code === section));

  function toggle(sectionCode: string, checked: boolean): void {
    const next = checked
      ? [...new Set([...selected, sectionCode])]
      : selected.filter((code) => code !== sectionCode);
    onChange(next);
  }

  const selectedLabel =
    selected.length === 0
      ? "All sections"
      : selected.length === 1
        ? (sections.find(({ code }) => code === selected[0])?.name ?? selected[0])
        : `${String(selected.length)} sections selected`;

  return (
    <div className="field communication-section-picker-field">
      <span className="field-label">Sections (optional)</span>
      <details className="communication-section-picker">
        <summary>
          <span>Member sections</span>
          <span className="communication-section-picker__summary-value">{selectedLabel}</span>
        </summary>
        <div className="communication-section-picker__panel">
          <p className="field-help">Choose one or more sections. Track-only sections are hidden.</p>
          <div className="checkbox-grid">
            {sections.map((section) => (
              <label className="checkbox-row" key={section.code}>
                <input
                  checked={selected.includes(section.code)}
                  onChange={(event) => {
                    toggle(section.code, event.target.checked);
                  }}
                  type="checkbox"
                />
                {section.name}
              </label>
            ))}
          </div>
          {selected.length > 0 ? (
            <button
              className="button button--secondary"
              onClick={() => {
                onChange([]);
              }}
              type="button"
            >
              Clear sections
            </button>
          ) : null}
        </div>
      </details>
    </div>
  );
}
