# Issue 315: Mobile Member navigation

The mobile Member workspace now uses full-width pages and Home, Schedule, Practice, and More bottom
controls. Desktop Member groups and preferences are preserved. ADR 0069 records the approved
replacement of the mobile rail. No routes, contracts, backend, or provider settings change.

## Implementation

- `AuthenticatedShell/MobileMemberNavigation.tsx` projects the filtered Member groups into direct
  links and menu buttons. The repository Dialog contains both menu links and bottom controls,
  retaining focus containment, background inertness, scroll locking, and unsaved-change guards.
- `AuthenticatedShell/mobileNavigation.tsx` shares menu destination presentation with Admin.
- `AuthenticatedShell/utils.ts` exposes the existing module projection for both shell use and tests.
- Shell styles remove the phone rail, reserve safe-area bottom clearance, and lift the SaveBar.
  Tablet drawers and desktop preferences remain independent from phone menu state.

## Reproduce verification and screenshots

Run from the repository root:

```sh
npm run test:ui -- MobileMemberNavigation MobileOrganizationAdminNavigation navigation.ui.test sidebarTransitions navigationPreferences
npm run test:e2e -- mobile-member-navigation.spec.ts --workers=1
npm run test:e2e -- organization-navigation.spec.ts member-practice.spec.ts sidebar.phase3.spec.ts --grep 'Member|member|cycles through repeat' --workers=1
npm run test:e2e -- organization-navigation.spec.ts --workers=1
npm run typecheck -w @choir/web
npm run build -w @choir/web
```

Playwright saves closed Schedule, Practice, More, desktop compact, and Resources-only captures in
both themes under the ignored `test-results/mobile-member-navigation-*` directories. Captures are
local browser evidence, not generated concepts; rerunning Playwright replaces the output directory.

Coverage includes module loading/error/disabled states and reactive removals, canonical destinations
and Calendar alias, guarded Profile navigation, modified links, menu switching and dismissal, focus
containment/restoration, schedule filter and scroll preservation, 320/375/390/430/768px, short
landscape, 200% zoom at a supported effective width, reduced motion, SaveBar clearance, desktop
preference round trips, Admin regressions, and simulated Practice playback preservation.

Practice tests mock media operations; they do not verify real codecs or hardware audio. Physical
mobile keyboards, hardware safe-area behavior, and screen-reader announcements require device
qualification. Existing blocked/malformed preference coverage remains in navigation preference
tests. No Worker integration or hosted qualification is needed for this frontend-only change. Full
release qualification is deferred until a push or staging release is requested. No deployment is
performed.

## Local results

- 78 focused UI tests passed across Member/Admin navigation, transitions, and preferences.
- 10 new desktop/mobile Chromium scenarios passed in both themes.
- 14 existing Member navigation/Practice scenarios passed, including simulated player preservation.
- All 12 existing Organization navigation scenarios passed in the broader browser run; its earlier
  failures were confined to the new zoom assertion, subsequently fixed and requalified above.
- Repository lint, formatting, all-workspace typechecks, and control-alignment/no-eyebrows/spacing
  gates passed. The web build passed without bundle warnings and retained split route chunks.
- The sandbox initially blocked the local fixture server bind; browser checks passed with local
  server permission. Enlargement also exposed a Member header overflow, fixed by allowing its header
  and action rows to wrap. CSS zoom exercises keyboard navigation because emulated touch hit testing
  under CSS zoom differs from physical browser zoom.

## Risk and rollback

Member destinations continue to come solely from the existing Organization-scoped Member catalog; an
administrator using Member mode gains no Admin menu entries. No data migration, network effect, or
new recurring work is introduced. Menu state is cleared on route, breakpoint, workspace, and
Organization changes. Revert the UI commit to restore the previous mobile rail; no data rollback is
required. Remaining risks are device-specific keyboard/safe-area and assistive-technology behavior.
