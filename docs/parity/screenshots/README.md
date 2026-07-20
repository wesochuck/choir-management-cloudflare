# Baseline Screenshot Evidence

These images are deterministic visual references captured from the pinned baseline frontend at
commit `6874d43a3c3698ae53218a44d17649bc454ca9ac` using empty API fixtures. They document layout,
responsive behavior, semantic color, typography, control hierarchy, and empty/default states; they
do not claim populated domain parity.

Regenerate only against the pinned parity worktree:

```bash
# In the parity worktree
npm run dev -- --host 127.0.0.1 --port 4174

# In this repository
BASELINE_URL=http://127.0.0.1:4174 node scripts/capture-baseline-screenshots.mjs
```

Expected captures:

- `baseline-login-desktop.png` and `baseline-login-mobile.png`
- `baseline-setup-desktop.png` and `baseline-setup-mobile.png`
- `baseline-public-home-desktop.png` and `baseline-public-home-mobile.png`

Feature waves add populated desktop/mobile screenshots before their visual matrix entries can be
verified. CI never starts or imports the legacy repository.

The baseline setup capture expands to 522 pixels from a 390-pixel viewport because its nine-step
indicator overflows horizontally. This is evidence of the legacy defect, not a requirement to repeat
it: the target must preserve the setup workflow while satisfying its responsive and accessibility
gates.
