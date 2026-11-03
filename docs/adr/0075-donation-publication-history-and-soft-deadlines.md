# Preserve donation publication history with soft deadlines

Status: Accepted; implemented locally on 2026-11-03. Decision date: 2026-11-02

An Organization configures one named donation-recognition publication at a time, with independently
optional overall recognition and artwork dates. Deadlines change publication expectations and staff
review status; they never close donations or authorized artwork submission. Late donor-facing copy
explicitly says inclusion in the named publication is no longer guaranteed, including in receipts.

Keep a donation's original publication association separate from staff-recorded inclusion in the
same or a later publication. Checkout captures the publication shown to the donor; successful
payment determines online recognition timing, while offline gifts use their actual received date.
Rollover does not reassign existing gifts or artwork links. Historical gifts start unassigned.
Deadline revisions preserve previously on-time submissions when a date moves earlier; extensions can
improve late status without erasing staff inclusion decisions or rewriting receipt history.

**Why:** A mutable current-settings-only model would change old donors' expectations and make late
artwork links refer to the wrong program. Automatic carry-forward could repeat recognition or
promise space in a publication staff has not reviewed. Retained publication/policy history costs
additional storage and evaluation logic but keeps donor communications and staff decisions
explainable across rollover and corrections. A passed date is not a payment or file-access barrier.

See the
[implementation plan](../plans/2026-11-02-donation-publication-deadlines-implementation-plan.md) for
persistence, UI, verification, and rollback requirements.
