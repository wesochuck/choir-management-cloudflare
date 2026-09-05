import { TabsList, TabsTrigger } from "@choir/ui";

export function SeatingTabs() {
  return (
    <div className="no-print">
      <TabsList aria-label="Seating tools" className="seating-tabs">
        <TabsTrigger aria-controls="seating-chart-panel" id="seating-chart-tab" value="chart">
          Chart
        </TabsTrigger>
        <TabsTrigger
          aria-controls="seating-formations-panel"
          id="seating-formations-tab"
          value="formations"
        >
          Formations
        </TabsTrigger>
      </TabsList>
    </div>
  );
}
