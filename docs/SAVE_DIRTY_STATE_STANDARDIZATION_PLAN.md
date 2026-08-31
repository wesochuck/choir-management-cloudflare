# Save / Dirty-State Standardization Plan

Repository: `wesochuck/choir-management-cloudflare`

Primary area: `apps/web`

Goal: Standardize how the web application handles drafts, dirty state, saves, discards, navigation
blocking, immediate mutations, and save concurrency without introducing a heavy form framework.

---

## 1. Objective

Create one consistent, predictable persistence and dirty-state model across the web application
while preserving different UX patterns where they are appropriate.

The application recognizes five intentional interaction and persistence patterns:

1. **Explicit page-level resource draft**
   - Use for multi-field settings pages, configuration views, and full-page editors.
   - Changes remain local until the user explicitly saves.
   - Dirty state is derived strictly by comparing the normalized current draft with the normalized
     last successfully persisted baseline.
   - Users can Save or Discard via the shared floating save bar.
   - Unsaved changes participate in centralized navigation, popstate (Back/Forward),
     workspace-switch, and sign-out protection.
   - Owned via `usePersistedDraft<T>()` and registered with `SaveCoordinator`.

2. **Modal dialog entity draft**
   - Use for creating or editing individual entities in modal dialogs (e.g. adding/editing an event
     in `TicketingManager`, editing a member profile in `RosterPageView`, editing a donation level
     in `DonationsManager`).
   - Managed locally inside the dialog using `@choir/ui` `Dialog`'s built-in dirty tracking / close
     confirmation.
   - Cancel buttons are wrapped in `<DialogClose asChild>` so that dismissal attempts (Cancel
     button, Escape key, backdrop click, or header close button) prompt before discarding unsaved
     edits.
   - **Critical rule:** Modal dialog drafts must **not** register with the global page-level
     `SaveCoordinator` or show the global floating save bar.

3. **Multi-step setup wizard**
   - Use for linear onboarding workflows (e.g. `SetupView`).
   - Progress is persisted atomically per step upon transition.
   - Unsaved input in the currently active step participates in leave confirmation if the user
     attempts to navigate away before proceeding.

4. **Immediate mutation**
   - Use for independent toggles, switches, and small settings where each change is its own complete
     action (e.g. `ModuleSettingsView`, payment module activation toggles).
   - Persist immediately on change with inline pending/error feedback.
   - Revert or refresh to previous state on failure.
   - Do not register as a page-wide dirty draft.

5. **Transactional action / command**
   - Use for password changes, file uploads, delete confirmations, renames, exports, and DNS
     verifications.
   - These are explicit single-purpose operations, not persistent page drafts.
   - Do not register command input as page-level dirty state unless there is a specific, documented
     UX requirement.

6. **Draft + publish**
   - Use for public website / CMS content workflows (`PublicWebsiteManager`).
   - Saving a draft and publishing are distinct operations.
   - Publishing only publishes a clearly defined, saved revision.
   - Unsaved edits remain visibly unsaved and do not affect the published site.

### Guardrail Constraints

- Do **not** standardize on autosaving every input field.
- Do **not** add React Hook Form, Formik, or another external form framework.
- Leverage the existing React 19 + TanStack Query stack.

---

## 2. Core Behavioral Contract

All explicit drafts managed by `usePersistedDraft<T>` must strictly adhere to this contract.

### 2.1 Dirty State Definition

Dirty state is a pure boolean equality check:

```text
dirty = (normalized(current draft) !== normalized(last successfully persisted baseline))
```

- **Not** based on "is touched", "was focused", or "has ever changed".
- If the user modifies a value from `A` to `B`, and then reverts the field back to `A`, the draft
  **must immediately become clean again** (`dirty === false`).
- When clean, the floating save bar disappears and navigation guards do not block.

### 2.2 Save Snapshot & Concurrency Isolation

A save operation must execute against an immutable snapshot of the draft captured at the exact
instant Save was initiated:

```text
Timeline:
1. Persisted baseline = Revision A
2. User edits draft -> Revision B
3. User triggers Save (captures Snapshot B, saveRevision = 1)
4. While HTTP request is in-flight, user edits draft -> Revision C (draftRevision = 2)
5. Save of Snapshot B succeeds (returns Persisted B)

Outcome:
- Persisted baseline updated to B
- Current draft remains C (Revision C is preserved intact; NOT overwritten with server response B)
- dirty === true (since normalized(C) !== normalized(B))
- Floating save bar remains visible with a polite status: "Draft saved; newer edits remain unsaved."
```

The completion of an earlier save request must **never**:

1. Overwrite edits made while the HTTP request was in flight.
2. Incorrectly mark newer in-flight edits as clean/saved.
3. Replace the current draft with an older server response.

### 2.3 Save Failure Behavior

If Save fails (e.g. network error, validation error, 409 Conflict):

- Keep the user's current draft completely intact.
- Keep `dirty === true`.
- Set an accessible error message (`role="alert"`).
- Allow immediate retry.
- Do **not** update the persisted baseline.

### 2.4 Discard Behavior

Discarding a draft must:

- Reset the current draft back to the last successfully persisted baseline.
- Clear draft-specific transient success messages and validation/server errors.
- Set `dirty === false`.
- Automatically dismiss the floating save bar.

### 2.5 Normalization & Equality

Normalization must mirror what the backend persistence layer actually stores:

- String trimming: Trim strings before comparison if the API trims them.
- Currency / Numbers: Normalize formatting (e.g. cents vs formatted dollar strings) before
  comparison.
- Unordered collections: Compare sets/arrays by content rather than incidental array order where
  appropriate.
- Avoid generic `JSON.stringify()` as the default equality strategy across arbitrary objects;
  support typed equality hooks per resource.

### 2.6 Background Query & External Cache Synchronization

When TanStack Query refetches data in the background (e.g. window focus, periodic sync):

- If `dirty === false`: Update both the persisted baseline and the local draft to reflect the fresh
  server data.
- If `dirty === true`: **Do NOT overwrite the dirty draft** with background query data (per
  `apps/web/AGENTS.md` Rule 12). Update the internal server baseline only if designed for background
  baseline tracking, or defer sync until the user saves or discards.

---

## 3. Known Flaws & Gaps in Existing Implementation

The following issues must be resolved as part of this initiative:

### 3.1 Unsafe `Promise.all()` in Floating Save Bar

- **File:** `apps/web/src/account/FloatingSaveBar.tsx`
- **Issue:** `FloatingSaveBarProvider` saves all registered dirty actions using `Promise.all()`.
  When multiple actions target the same underlying server resource (or have implicit dependencies),
  parallel execution causes severe race conditions and last-write-wins data loss.
- **Resolution:**
  1. Enforce single-draft ownership per server resource.
  2. For truly independent resources, use `Promise.allSettled()` so partial failures do not obscure
     successes.

### 3.2 Music Library Settings Save Collision

- **File:** `apps/web/src/account/MusicLibrarySettingsPage.tsx`
- **Issue:** Catalog settings registers action `"organization-music-library-catalog-settings"`, and
  Practice settings registers `"organization-music-library-practice-settings"`. Both update
  `OrganizationMusicLibrarySettings` based on a stale `savedSettings` snapshot. Saving from the
  floating bar causes whichever finishes last to overwrite the other.
- **Resolution:** Consolidate the entire page into a single
  `usePersistedDraft<OrganizationMusicLibrarySettings>()`.

### 3.3 Roster Settings & Automation Hidden Panel Race

- **Files:**
  - `apps/web/src/account/RosterConfiguration.tsx`
  - `apps/web/src/account/RosterAutomationSettings.tsx`
  - `apps/web/src/account/components/RosterPage/view.tsx`
- **Issue:** `RosterPageView` keeps both `RosterConfiguration` and `RosterAutomationSettings`
  mounted simultaneously in hidden tab panels. Both register separate save actions
  (`"organization-roster-configuration"` and `"organization-roster-automation"`) that mutate
  `OrganizationRosterConfiguration`. If both tabs are edited, the floating bar triggers simultaneous
  conflicting writes.
- **Resolution:** Elevate draft state to a shared `RosterConfigurationDraftProvider` owned at the
  `RosterPageView` level, or provide unified resource draft management so exactly one action is
  registered for `OrganizationRosterConfiguration`.

### 3.4 Browser Back / Forward (`popstate`) Bypasses Unsaved-Changes Guard

- **File:** `apps/web/src/account/components/AuthenticatedShell/hooks.ts`
- **Issue:** The `useRoute()` hook listens to `popstate` and immediately invokes
  `setRoute(readRoute())` without checking `dirtyActions`. Clicking browser Back or Forward silently
  discards dirty drafts.
- **Resolution:** Intercept `popstate`. If dirty drafts exist:
  1. Prevent the route transition in React state.
  2. Push the current route back onto `window.history` to maintain URL synchronization while showing
     the confirmation dialog.
  3. Prompt the user via `@choir/ui` `useConfirmation`.
  4. If confirmed ("Discard & Leave"): discard drafts and navigate to the target entry.
  5. If cancelled ("Stay"): remain on the current page with dirty state intact.

### 3.5 Workspace Switching Applies Premature Side Effects

- **File:** `apps/web/src/account/components/AuthenticatedShell/shell.tsx`
- **Issue:** `switchWorkspace()` writes to React state and `localStorage` before calling
  `navigate()`. If the user cancels the unsaved changes prompt, the workspace selection and
  `localStorage` remain incorrectly altered.
- **Resolution:** Defer state and `localStorage` updates until _after_ navigation is approved by the
  leave guard (`onApproved` callback).

### 3.6 Sign-Out Bypasses Unsaved Changes Protection

- **File:** `apps/web/src/account/components/AuthenticatedShell/shell.tsx`
- **Issue:** Header "Sign out" button calls `signOut().then(onSignedOut)` directly without checking
  dirty actions.
- **Resolution:** Route sign-out through the centralized
  `requestLeave({ action: signOut, reason: "sign-out" })` guard.

### 3.7 Branding Logo Upload/Remove Accidental Save of Address Draft

- **File:** `apps/web/src/account/OrganizationBrandingPanel.tsx`
- **Issue:** When uploading or removing a logo, `updateOrganizationBranding` sends the current
  uncommitted `physicalAddress` text input value. If a user is mid-edit on the address and uploads a
  logo, their unsaved address is silently committed to the backend.
- **Resolution:** When performing logo mutations, send the _persisted baseline_ physical address
  (`branding?.physicalAddress ?? null`) rather than the uncommitted textarea draft, or separate the
  draft address lifecycle from immediate logo operations.

### 3.8 Standalone Forms Missing Navigation & Save Bar Integration

- **Files:**
  - `apps/web/src/account/OrganizationEmailSettingsPanel.tsx` (has local Save button, does not
    participate in floating save bar or leave guard).
  - `apps/web/src/account/MemberProfileDirectory.tsx` (`MemberProfileEditor` has local Save button,
    missing floating save bar and leave guard).
  - `apps/web/src/account/OrganizationSettingsPage.tsx` (timezone and transaction fees are
    registered, but should be migrated to `usePersistedDraft`).
  - `apps/web/src/account/components/AuditionManager/settings/SettingsForm.tsx` (uses bespoke dirty
    check and local save button alongside floating save).
  - `apps/web/src/account/components/DonationsManager/hooks.ts` (`useDonationPortalCopy` registers
    floating save with bespoke dirty logic).
- **Resolution:** Standardize all page-level settings forms on `usePersistedDraft`.

---

## 4. Target Architecture

The standardization introduces four clean modules under `apps/web/src/persistence/`:

```text
apps/web/src/persistence/
  types.ts                    # Core contracts, draft options, and coordinator interfaces
  usePersistedDraft.ts        # Typed hook managing snapshotting, revision tracking, dirty state, and saves
  SaveCoordinator.tsx         # Context & provider tracking all registered explicit drafts across the app
  SaveBar.tsx                 # Accessible, floating status bar for dirty state and save/discard actions
  UnsavedChangesGuard.tsx     # Centralized leave guard (links, popstate, workspace switch, sign-out)
  index.ts                    # Public barrel exports
```

### 4.1 `usePersistedDraft<T>`

A reusable, fully typed hook for managing a single logical server resource draft:

```ts
export interface PersistedDraftOptions<T, TRequest = T> {
  readonly initialValue: T | null;
  readonly resourceKey: string;
  readonly toRequest?: (value: T) => TRequest;
  readonly normalize?: (value: TRequest) => TRequest;
  readonly equals?: (a: TRequest, b: TRequest) => boolean;
  readonly save: (draft: TRequest) => Promise<T>;
  readonly onSaveSuccess?: (saved: T) => void;
  readonly onSaveError?: (error: unknown) => void;
  readonly autoRegister?: boolean; // Defaults to true (registers with SaveCoordinator)
}

export interface PersistedDraftReturn<T, TRequest = T> {
  readonly draft: TRequest | null;
  readonly setDraft: (updater: TRequest | ((prev: TRequest) => TRequest)) => void;
  readonly updateField: <K extends keyof TRequest>(key: K, value: TRequest[K]) => void;
  readonly replaceDraft: (value: TRequest) => void;
  readonly persisted: T | null;
  readonly dirty: boolean;
  readonly saving: boolean;
  readonly save: () => Promise<boolean>;
  readonly discard: () => void;
  readonly error: string | null;
  readonly clearError: () => void;
  readonly lastSavedAt: number | null;
}
```

#### Key Implementation Invariants:

1. **Revision Counter Ref:** `draftRevisionRef` increments on every draft edit.
2. **Snapshot Capture:** When `save()` is invoked, capture `saveRevision = draftRevisionRef.current`
   and `draftSnapshot = draft`.
3. **Stale Completion Protection:** When the save promise resolves:
   - Persisted baseline is updated to the server response.
   - If `draftRevisionRef.current === saveRevision`: update `draft` to the normalized server
     response; `dirty` becomes `false`.
   - If `draftRevisionRef.current > saveRevision`: retain local `draft` modifications; `dirty`
     remains `true`.
4. **Error Cleanup:** If `save()` rejects, leave `draft` intact, set `error`, leave `persisted`
   untouched.

### 4.2 `SaveCoordinator` & Context

Central registry for all active page-level drafts:

```ts
export interface SaveRegistration {
  readonly id: string;
  readonly resourceKey: string;
  readonly dirty: boolean;
  readonly busy: boolean;
  readonly save: () => Promise<boolean>;
  readonly discard: () => void;
}

export interface SaveCoordinatorContextValue {
  readonly register: (registration: SaveRegistration) => () => void;
  readonly isDirty: boolean;
  readonly isSaving: boolean;
  readonly dirtyCount: number;
  readonly saveAll: () => Promise<{ success: boolean; errors: readonly string[] }>;
  readonly discardAll: () => void;
  readonly requestLeave: (options: LeaveOptions) => Promise<boolean>;
}
```

#### Rules:

- **Duplicate Detection:** If two components attempt to register active drafts with the same
  `resourceKey` simultaneously, throw an error in development or log a loud console warning.
- **Multi-Resource Saves:** When multiple independent resources are dirty, `saveAll()` executes
  saves using `Promise.allSettled()`. Partial successes update their respective baselines; partial
  failures retain dirty state and surface error banners.

### 4.3 `SaveBar` UI Component

The visual floating save bar consumes state strictly from `SaveCoordinatorContext`:

- **Aria / Accessibility:**
  - Container uses `role="region"` with `aria-label="Unsaved changes"`.
  - State changes announced via polite live region (`aria-live="polite"`).
  - Transitions announced: "You have unsaved changes", "Saving changes…", "All changes saved". Avoid
    announcements on every keystroke.
  - Native `<button>` elements with clear focus rings.
- **Actions:**
  - `[Discard]`: Triggers `discardAll()`.
  - `[Save changes]`: Triggers `saveAll()`.

### 4.4 `UnsavedChangesGuard` & Navigation Blocker

Centralizes leave protection across all exit vectors:

```ts
export interface LeaveOptions {
  readonly action: () => void | Promise<void>;
  readonly reason: "navigate" | "popstate" | "workspace-switch" | "sign-out" | "tab-close";
  readonly title?: string;
  readonly description?: string;
}
```

#### Exit Vectors Covered:

1. **In-App SPA Link Navigation (`navigate(href)`):** Intercepted via `requestLeave`.
2. **Browser Back / Forward (`popstate`):** Intercepted, history position preserved during prompt,
   executed on approval.
3. **Workspace Switching (`switchWorkspace(target)`):** Side effects deferred until approved.
4. **Sign-Out (`signOut()`):** Prompts with reason-specific copy: _"Sign out with unsaved changes?
   Your unsaved changes will be discarded if you sign out."_
5. **Browser Tab Close / Reload:** `window.addEventListener("beforeunload", ...)` active whenever
   `isDirty === true`.

---

## 5. TanStack Query Integration Guidelines

1. **Mutation Encapsulation:** `usePersistedDraft` can accept a TanStack Query `useMutation` hook or
   standard API function for `save`.
2. **Query Invalidation:** On save success, invalidate the corresponding query key (e.g.
   `queryKeys.organization.emailSettings`) so other readers across the application synchronize.
3. **Query Loading Guard:** Never render an editable form from empty fallback data while initial
   queries are pending (`isLoading === true`). Always show an explicit loading indicator and
   initialize drafts only when data is confirmed.
4. **Background Refetch Protection:** Background queries must not overwrite active drafts when
   `dirty === true`.

---

## 6. Backend Concurrency Hardening (API Layer)

While client-side consolidation prevents same-browser race conditions, multi-administrator
concurrency requires backend safeguards:

### 6.1 Field-Level PATCH Semantics

Where sub-sections of a configuration are logically independent (e.g. Music Library Catalog Search
vs Practice Player Lifetime), ensure the API supports updating individual fields without requiring a
full-object round-trip:

```http
PATCH /api/organization/music-library/settings
Content-Type: application/json

{
  "practicePlayerLinkLifetimeDays": 30
}
```

### 6.2 Optimistic Concurrency Tokens (ETag / Version)

For atomic, whole-resource configurations (e.g. `OrganizationRosterConfiguration`,
`PublicWebsiteSettings`):

1. Return a numeric `version` or `updatedAt` timestamp on read.
2. Require the update payload to include the expected `version`.
3. If stale, the Worker returns `409 Conflict`.
4. The client surfaces an actionable alert: _"These settings were modified by another administrator.
   Please reload to view the latest version."_

---

## 7. Migration Plan (Phased Execution)

### Phase 1: Core Persistence Architecture & Navigation Guards

1. Build `apps/web/src/persistence/`:
   - `types.ts`
   - `usePersistedDraft.ts` with comprehensive unit tests.
   - `SaveCoordinator.tsx` with duplicate `resourceKey` detection.
   - `SaveBar.tsx`.
   - `UnsavedChangesGuard.tsx` / `useNavigationGuard`.
2. Replace legacy `FloatingSaveBarProvider` in `AuthenticatedShell` with `SaveCoordinatorProvider` +
   `SaveBar`.
3. Wire `useRoute()` to use `UnsavedChangesGuard` for in-app links and `popstate`.
4. Update `switchWorkspace()` to commit state only after leave approval.
5. Wire header `signOut()` to `requestLeave`.

_Acceptance Gate:_ Unit tests pass; Back/Forward, workspace-switching, and sign-out prompt reliably
when dirty.

### Phase 2: Consolidate Multi-Section Same-Resource Races

1. **Music Library Settings:**
   - Consolidate `MusicLibrarySettingsPage.tsx` catalog and practice forms into one
     `usePersistedDraft<OrganizationMusicLibrarySettings>()`.
   - Remove duplicate local save buttons; rely on unified `SaveBar`.
2. **Roster Settings & Automation:**
   - Consolidate `RosterConfiguration.tsx` and `RosterAutomationSettings.tsx` into a single resource
     draft managed at `RosterPageView`.
   - Ensure both tab views edit the shared draft without conflicting registrations.
3. **Organization Branding:**
   - Fix `OrganizationBrandingPanel.tsx` so logo upload/removal preserves the persisted address
     rather than sending dirty textarea input.
   - Migrate physical address editing to `usePersistedDraft`.

_Acceptance Gate:_ Automated integration tests verify that editing multiple sections simultaneously
and saving preserves both updates.

### Phase 3: Migrate Remaining Settings & Forms

1. Migrate `OrganizationEmailSettingsPanel.tsx` to `usePersistedDraft`.
2. Migrate `OrganizationSettingsPage.tsx` (Timezone & Transaction Fees) to `usePersistedDraft`.
3. Migrate `MemberProfileDirectory.tsx` (`MemberProfileEditor`) to `usePersistedDraft`.
4. Migrate `AuditionManager/settings/SettingsForm.tsx` to `usePersistedDraft`.
5. Migrate `DonationsManager/hooks.ts` (`useDonationPortalCopy`) to `usePersistedDraft`.
6. Refactor `PublicWebsiteManager.tsx` to use the shared `usePersistedDraft` hook, deprecating its
   bespoke revision logic while preserving draft/publish UX.
7. Clean up deprecated `useFloatingSaveAction` and `FloatingSaveBar.tsx`.

_Acceptance Gate:_ All migrated forms participate in uniform dirty tracking, floating save bar, and
leave protection.

### Phase 4: API Concurrency & Hardening

1. Review Worker update endpoints for `roster/configuration`, `music-library/settings`, `branding`,
   and `public-website/settings`.
2. Add partial update PATCH support or version-based 409 Conflict handling.
3. Ensure UI gracefully displays 409 conflict errors with reload options.

---

## 8. Comprehensive Testing Matrix

### 8.1 `usePersistedDraft` Hook Unit Tests

- **Initial State:** `persisted = A`, `draft = A`, `dirty = false`, `saving = false`.
- **Field Modification:** Edit field -> `draft = B`, `dirty = true`.
- **Reversion:** Edit field back to original -> `draft = A`, `dirty = false`.
- **Successful Save:** `save()` resolves -> `persisted = B`, `draft = B`, `dirty = false`.
- **Failed Save:** `save()` rejects -> `persisted = A`, `draft = B`, `dirty = true`, `error` is set.
- **Edit During Save (Snapshot Isolation):**
  - Save starts for `B` (revision 1).
  - Draft updated to `C` (revision 2) while save is in flight.
  - Save of `B` resolves -> `persisted = B`, `draft = C`, `dirty = true`.
- **Late Save Overwrite Prevention:** Ensure an older slow save cannot overwrite a subsequent
  completed save.
- **Discard:** Reset `draft` to `persisted`, clear error, `dirty = false`.
- **Custom Normalization:** Verify leading/trailing whitespace trimming does not trigger false dirty
  state.
- **External Query Sync:** When clean, updating initial value updates draft; when dirty, draft is
  preserved.

### 8.2 `SaveCoordinator` Unit Tests

- Single dirty resource registration.
- Multiple independent dirty resources.
- Duplicate `resourceKey` registration throws/warns in development.
- `saveAll()` with `Promise.allSettled()` handling partial success/failure.
- `discardAll()` resets all registered drafts.
- Unmounting a component unregisters its draft cleanly.

### 8.3 Navigation & Blocker Integration Tests

- In-app link click while dirty -> modal opens -> click "Stay" -> remains on page.
- In-app link click while dirty -> modal opens -> click "Discard" -> navigates and discards.
- Browser Back (`popstate`) while dirty -> modal opens -> click "Stay" -> stays on URL and page.
- Browser Back (`popstate`) while dirty -> modal opens -> click "Discard" -> navigates back.
- Workspace switch while dirty -> Cancel -> workspace selector and localStorage remain unchanged.
- Sign out while dirty -> Cancel -> stays logged in with draft intact.
- Sign out while dirty -> Confirm -> signs out.
- BeforeUnload event handler registered when `isDirty === true` and removed when
  `isDirty === false`.

### 8.4 Multi-Section Concurrency Regression Tests

- **Music Library:** Edit catalog row size AND practice link lifetime -> save -> reload -> verify
  both persisted.
- **Roster Page:** Edit section name in Settings AND timeout days in Automation -> save -> reload ->
  verify both persisted.
- **Branding Panel:** Enter text in physical address -> upload logo -> verify address draft is NOT
  prematurely saved to backend.

---

## 9. Accessibility (a11y) Standards

- **Floating Save Bar:** Marked with `role="region"` and `aria-label="Unsaved changes"`.
- **Status Announcements:** Polite live regions (`aria-live="polite"`) announce state transitions
  ("You have unsaved changes", "Saving changes…", "Draft saved"). Never flood screen readers on
  every keystroke.
- **Error Feedback:** Errors use `role="alert"` for immediate screen-reader awareness.
- **Keyboard Navigation:** Native buttons with visible focus rings. Focus is returned to the
  invoking trigger when dismissing confirmation dialogs.
- **No Focus Stealing:** Becoming dirty must **not** yank keyboard focus to the floating save bar.
- **Dialog Trapping:** Confirmation dialogs use `@choir/ui` `Dialog` / `ConfirmDialog` built on
  Radix primitives with robust focus trapping and Escape handling.

---

## 10. File Responsibility Map

```text
Existing Files to Modify / Consolidate:
- apps/web/src/account/components/AuthenticatedShell/hooks.ts         (Wire popstate and navigation guard)
- apps/web/src/account/components/AuthenticatedShell/shell.tsx         (Replace legacy FloatingSaveBarProvider, guard workspace switch and signout)
- apps/web/src/account/MusicLibrarySettingsPage.tsx                   (Consolidate catalog & practice drafts)
- apps/web/src/account/RosterConfiguration.tsx                         (Consolidate with RosterAutomationSettings)
- apps/web/src/account/RosterAutomationSettings.tsx                   (Consolidate with RosterConfiguration)
- apps/web/src/account/components/RosterPage/view.tsx                  (Provide unified draft context for roster)
- apps/web/src/account/OrganizationBrandingPanel.tsx                  (Decouple logo upload from address draft; migrate address)
- apps/web/src/account/OrganizationEmailSettingsPanel.tsx              (Migrate to usePersistedDraft)
- apps/web/src/account/OrganizationSettingsPage.tsx                   (Migrate timezone and transaction fees)
- apps/web/src/account/MemberProfileDirectory.tsx                     (Migrate MemberProfileEditor to usePersistedDraft)
- apps/web/src/account/components/AuditionManager/settings/SettingsForm.tsx (Standardize on usePersistedDraft)
- apps/web/src/account/components/DonationsManager/hooks.ts            (Standardize useDonationPortalCopy on usePersistedDraft)
- apps/web/src/account/PublicWebsiteManager.tsx                        (Migrate to usePersistedDraft)
- apps/web/AGENTS.md                                                   (Update documentation to reference usePersistedDraft)

Files to Deprecate / Remove after migration:
- apps/web/src/account/FloatingSaveBar.tsx                            (Replaced by apps/web/src/persistence/SaveBar.tsx)
- apps/web/src/account/useFloatingSaveAction.ts                       (Replaced by apps/web/src/persistence/usePersistedDraft.ts)

New Files to Create:
- apps/web/src/persistence/types.ts
- apps/web/src/persistence/usePersistedDraft.ts
- apps/web/src/persistence/usePersistedDraft.test.ts
- apps/web/src/persistence/SaveCoordinator.tsx
- apps/web/src/persistence/SaveCoordinator.test.tsx
- apps/web/src/persistence/SaveBar.tsx
- apps/web/src/persistence/UnsavedChangesGuard.tsx
- apps/web/src/persistence/UnsavedChangesGuard.test.tsx
- apps/web/src/persistence/index.ts
```

---

## 11. Definition of Done

This standardization is complete when all of the following conditions are met:

1. **Unified Model:** There is exactly one documented and implemented persistence model for explicit
   drafts across `apps/web`.
2. **Zero Same-Resource Races:** Music Library and Roster pages cannot lose settings when multiple
   sub-sections are edited simultaneously.
3. **Robust Navigation Protection:** In-app links, browser Back/Forward (`popstate`), workspace
   switching, and sign-out all reliably prompt before discarding dirty state.
4. **Clean Cancel Behavior:** Cancelling any leave action leaves the current route, workspace
   selection, and dirty draft completely unchanged.
5. **Snapshot Isolation:** Edits made while a save is in flight are preserved and remain dirty after
   the older save succeeds.
6. **No Silent Overwrites:** Stale server completions or background query refetches never overwrite
   dirty user input.
7. **Side-Effect Isolation:** Uploading/removing a branding logo cannot accidentally persist an
   uncommitted address draft.
8. **Accessibility Compliance:** All save bar and dialog elements satisfy keyboard accessibility,
   focus management, and screen-reader polite live region standards.
9. **No Heavy Dependencies:** No form libraries (React Hook Form, Formik, etc.) were added.
10. **Test Coverage:** Comprehensive unit, integration, and regression test suites pass cleanly
    across all persistence primitives and migrated screens.
