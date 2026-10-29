# ADR 0069: Mobile Member bottom navigation

Status: Accepted

## Context

Issue #315 approves full-width mobile Member content using the bottom navigation pattern introduced
for Organization Admin by ADR 0068. It supersedes issue #297's persistent mobile Member rail
requirement. Desktop navigation remains unchanged.

## Decision

At <=48rem, replace the Member rail and reserved left column with Home, Schedule, Practice, and
More. Derive eligible destinations, labels, icons, and order from the existing filtered Member
navigation groups. Home opens Dashboard, Schedule opens My schedule, Practice opens Practice &
resources, and More opens Your membership without Schedule. Omit empty groups.

Group buttons open one naturally sized repository Dialog with the bottom controls inside its modal
footer. Current route and open menu remain separate states. Destination links retain native
modified-click behavior and close only after guarded navigation succeeds. Dismissal preserves the
underlying mounted page. Route, workspace, Organization, and breakpoint changes reset transient
menus. Reserve bottom content and floating SaveBar clearance including safe areas.

## Consequences

Phone pages regain full width without changing member routes, modules, permissions, or desktop
preferences. Account, Platform, and Organization Admin navigation remain unchanged. No storage
migration or external effect is required; rollback is a UI revert with no data rollback.
