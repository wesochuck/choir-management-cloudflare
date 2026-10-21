# Issue 283 navigation evidence

The starting main commit was `df0113f`. Its unchanged visual baseline is retained in
[issue 280 evidence](../issue-280/README.md): expanded desktop and mobile drawer, in both themes.
There was no compact rail before this change; Collapse hid the sidebar. The new captures show the
approved redesign, rather than pixel equality with that historical baseline.

## After captures

| State                                  | Light                        | Dark                       |
| -------------------------------------- | ---------------------------- | -------------------------- |
| Desktop expanded, full catalog         | [Light](expanded-light.webp) | [Dark](expanded-dark.webp) |
| Desktop compact, full catalog          | [Light](compact-light.webp)  | [Dark](compact-dark.webp)  |
| Mobile drawer, full catalog            | [Light](drawer-light.webp)   | [Dark](drawer-dark.webp)   |
| Desktop representative reduced catalog | [Light](reduced-light.webp)  | [Dark](reduced-dark.webp)  |

The full catalog has 25 sidebar destinations and 22 cards in matching 5/5/4/6/2 groups. The
representative reduced fixture enables roster, events, music library and public website; all other
modules are explicitly disabled. It has seven cards and hides the empty Communications group. This
is an explicit browser fixture, **not a fetched staging Organization catalog**: this workstation has
no cached authenticated staging application session. No staging module settings were changed for
screenshots.

`organization-navigation.spec.ts` captures the full catalog at 1440px, the compact rail at 1440px,
the drawer at 375px, and reduced catalog at 1024px. It asserts overflow/target geometry at 320/375px
and overflow at 768/1024/1440px; existing Overview tests retain 3/2/1 card-grid assertions. Both
themes cover independent accordion controls, saved preferences, keyboard flyouts, Escape focus,
outside dismissal, navigation, full command palette and mobile current-page state. Existing guard,
entity-search, module synchronization and other-workspace journeys remain in the complete suite.

Regenerate PNGs/attachments using the repository Playwright command:

```sh
npm run test:e2e -- organization-navigation.spec.ts
```

Original PNGs live under ignored `test-results/`. The committed copies use Sharp's lossless WebP
conversion without resizing. Navigation-specific Chromium/mobile and WebKit smoke coverage uses
mocked API fixtures; service workers are blocked for these reload journeys so WebKit does not bypass
route interception. The existing full-stack/service-worker suites remain enabled.
