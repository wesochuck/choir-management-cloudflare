export const queryKeys = {
  health: ["health"] as const,
  organization: {
    all: ["organization"] as const,
    attendance: (eventId: string) => ["organization", "events", eventId, "attendance"] as const,
    calendarSettings: ["organization", "calendar-settings"] as const,
    contactDetail: (contactId: string) => ["organization", "contacts", contactId] as const,
    contactImport: (importId: string) => ["organization", "contact-imports", importId] as const,
    contactImports: ["organization", "contact-imports"] as const,
    contactLists: ["organization", "contact-lists"] as const,
    contactProfiles: ["organization", "contacts", "profiles"] as const,
    contacts: (filters: {
      readonly listId?: string | undefined;
      readonly query?: string | undefined;
      readonly source?: string | undefined;
      readonly status?: string | undefined;
    }) => ["organization", "contacts", "list", filters] as const,
    directory: ["organization", "directory"] as const,
    donationSettings: ["organization", "donation-settings"] as const,
    donations: ["organization", "donations"] as const,
    events: ["organization", "events"] as const,
    modules: ["organization", "modules"] as const,
    patrons: ["organization", "patrons"] as const,
    pollDetails: (pollId: string) => ["organization", "polls", pollId] as const,
    pollResults: (pollId: string) => ["organization", "polls", pollId, "results"] as const,
    polls: (archived = false) => ["organization", "polls", { archived }] as const,
    resources: ["organization", "resources"] as const,
    rsvpBootstrap: ["organization", "rsvp", "bootstrap"] as const,
    rsvpHistory: (eventId: string) => ["organization", "events", eventId, "history"] as const,
    setupStatus: ["setup", "status"] as const,
    ticketOrders: ["organization", "ticket-orders"] as const,
    venues: ["organization", "venues"] as const,
  },
  public: {
    all: ["public"] as const,
    auditionSettings: ["public", "audition-settings"] as const,
    donationSettings: ["public", "donation-settings"] as const,
    feeSettings: ["public", "fee-settings"] as const,
    poll: (token: string) => ["public", "poll", token] as const,
    rsvp: (token: string) => ["public", "rsvp", token] as const,
  },
} as const;
