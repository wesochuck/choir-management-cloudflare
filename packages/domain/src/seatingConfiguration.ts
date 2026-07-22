export const defaultSeatingConfiguration = {
  defaultFormationId: "columns-standard",
  formations: [
    {
      id: "columns-standard",
      isVoicePartLayout: false,
      name: "Standard Columns (S-A-T-B Left to Right)",
      sectionOrder: ["S", "A", "T", "B"],
      strategy: "vertical_column",
    },
    {
      id: "rows-standard",
      isVoicePartLayout: false,
      name: "Standard Rows (S-A-T-B Front to Back)",
      sectionOrder: ["S", "A", "T", "B"],
      strategy: "horizontal_row",
    },
  ],
} as const;
