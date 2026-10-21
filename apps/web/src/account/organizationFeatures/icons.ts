/** One semantic SVG path catalog shared by every Organization feature surface. */
export const organizationFeatureIcons = {
  home: "m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9",
  roster:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  contacts:
    "M4 3h15v18H4zM2 7h4M2 12h4M2 17h4M14 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0M8 17v-1a4 4 0 0 1 8 0v1",
  invitations: "M21 10V4H3v16h10M3 5l9 7 9-7M18 14v8M14 18h8",
  directory: "M12 5v16M12 5C9 2 5 2 2 3v17c4-1 7-1 10 1 3-2 6-2 10-1V3c-3-1-7-1-10 2",
  auditions: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0zM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8",
  events: "M3 5h18v16H3zM7 2v6M17 2v6M3 10h18M7 14h3M14 14h3",
  venues: "M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  rsvp: "M9 3H5v18h14V3h-4M9 2h6v4H9zM8 13l3 3 5-6",
  attendance: "M9 3H3v18h18V11M7 11l5 5L22 3",
  seating: "M6 3h12v10H6zM4 13h16v5H4zM6 18v4M18 18v4",
  music: "M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  setlists: "M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1",
  resources: "M2 6h8l2 3h10v12H2zM2 6V3h7l3 3h8v3",
  website: "M22 12A10 10 0 1 1 2 12a10 10 0 0 1 20 0M2 12h20M12 2c6 5 6 15 0 20-6-5-6-15 0-20",
  communications: "M2 4h20v16H2zM2 5l10 8L22 5",
  polls: "M4 21V11h4v10M10 21V3h4v18M16 21v-7h4v7",
  ticketing: "M3 5h18v5a2 2 0 0 0 0 4v5H3v-5a2 2 0 0 0 0-4zM15 5v3M15 11v2M15 16v3",
  donations: "M3 8h18v4H3zM5 12v9h14v-9M12 8v13M12 8C2 8 5-2 12 8c7-10 10 0 0 0",
  wallet: "M21 8H3V4h16v4M3 8v13h18V8M21 12h-6v5h6M17 14.5h1",
  reports: "M3 3v18h18M7 16l5-6 4 3 5-8",
  settings: "M9 3h6l1 4 4 1 1 6-4 2-1 4H8l-1-4-4-2 1-6 4-1zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  patrons: "M3 3h18l2 6-11 13L1 9zM1 9h22M8 3 6 9l6 13 6-13-2-6",
} as const;
export type OrganizationIconId = keyof typeof organizationFeatureIcons;
