export interface SeatingTabsProps {
  readonly formationTab: "chart" | "formations";
  readonly setFormationTab: (tab: "chart" | "formations") => void;
}

export function SeatingTabs({ formationTab, setFormationTab }: SeatingTabsProps) {
  return (
    <div aria-label="Seating tools" className="seating-tabs no-print" role="tablist">
      <button
        aria-controls="seating-chart-panel"
        aria-selected={formationTab === "chart"}
        className={formationTab === "chart" ? "is-active" : ""}
        id="seating-chart-tab"
        onClick={() => {
          setFormationTab("chart");
        }}
        role="tab"
        type="button"
      >
        Chart
      </button>
      <button
        aria-controls="seating-formations-panel"
        aria-selected={formationTab === "formations"}
        className={formationTab === "formations" ? "is-active" : ""}
        id="seating-formations-tab"
        onClick={() => {
          setFormationTab("formations");
        }}
        role="tab"
        type="button"
      >
        Formations
      </button>
    </div>
  );
}
