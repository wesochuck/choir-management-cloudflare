# Hybrid Client-Side Navigation and Tenant-Bounded RPC for Admin Command Palette

The application provides an **Admin Command Palette** (`Cmd/Ctrl + K`) for Organization
Administrators, Organization Owners, and Platform Administrators in Delegated Administration mode.

The palette supports fast keyboard navigation, categorized search results (_Navigation & Settings_,
_Roster_, _Events_, _Music Library_, _Quick Actions_), prefix shortcuts (`roster:`, `event:`,
`music:`, `settings:`), and recently navigated items persisted in local storage.

### Architectural Decisions

1. **Hybrid Query Execution**:
   - Static administrative navigation routes, deep-link settings tabs (e.g. Dues, Communication
     Providers, Roster Automation, Seating Formations), and client commands resolve instantly
     in-memory on the client without network latency.
   - Domain entity search (Roster Profiles, Events, Music Library Pieces, Engagement Polls) executes
     via a consolidated, debounced RPC query against the Organization Durable Object.
2. **Tenant Isolation & Security**:
   - The search endpoint is strictly scoped to the active tenant's Durable Object. Operational
     search queries never cross Organization boundaries.
   - Search indexing is restricted to safe administrative identity fields (display name, legal name,
     email, part assignment, status). Sensitive recovery secrets, tokens, and private billing
     credentials are never indexed or returned.
   - Owner-only administrative destinations (such as Connected Payment Account onboarding,
     Organization Deletion, and Ownership Transfer) are hidden from search results for users lacking
     the Organization Owner role.
   - Inactive or disabled Modules are excluded from search results.
3. **Adaptive UI Entry Points**:
   - Prominent hero search bar on the Organization Admin Overview (`/admin` home).
   - Persistent quick-search input at the top of the navigation sidebar on inner admin pages.
   - Responsive top-header / mobile sheet trigger when the sidebar is collapsed or on compact
     viewports.

**Why:** Pre-loading entire tenant catalogs (potentially thousands of music pieces and communication
records) into the browser bundle would harm page load performance and violate memory budgets.
Conversely, pure server-side routing introduces latency into basic tab and page jumping. A hybrid
architecture delivers instantaneous navigation response while keeping domain queries lightweight,
secure, and tenant-isolated.
