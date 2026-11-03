# Donation publication deadlines — design interview

Status: Shared understanding confirmed on 2026-11-02. These notes preserve the design interview; the
[implementation plan](2026-11-02-donation-publication-deadlines-implementation-plan.md) is the
working handoff. Implementation is now tracked in that plan.

## Confirmed decisions

- Configure one named publication at a time for each Organization.
- Share two overall dates across all donation levels: the name-recognition cutoff and the artwork
  submission deadline. Do not configure dates per donation level.
- Donations remain open after either date. Continue accepting late artwork and clearly state that
  inclusion in the named publication is no longer guaranteed.
- Make publication expectations clear on the donation page and in the receipt email, including the
  applicable late-submission warning.
- Switching to a new publication applies to new donations. Existing donations and their artwork
  links retain their original publication and deadlines; they do not silently move to the next
  publication.
- Successful payment, rather than starting checkout, determines whether an online donation meets the
  name-recognition cutoff.
- An online checkout retains the publication presented when checkout began, even if staff activate a
  different publication before payment completes. Evaluate lateness using successful payment time
  for that original publication; staff may consider the gift for a later publication through review.
- Manually recorded checks and cash use the actual gift-received date entered by staff, rather than
  the date of data entry, when evaluating the name-recognition cutoff.
- Highlight donations paid after the recognition cutoff and artwork received after the artwork
  deadline for staff review, with separate labels identifying the missed deadline. Staff may
  consider these for a later publication such as the spring program; no automatic reassignment is
  implied.
- Staff can record that a reviewed donation was included in a named publication, such as "Included
  in Spring program." Preserve the original donation and publication details; recording inclusion
  removes the item from outstanding review so it is not considered twice.
- Extending a publication's deadline reevaluates existing late flags for that same publication
  against the new date. Preserve staff-recorded inclusion decisions and leave previously sent
  receipts unchanged. Switching publications remains separate from editing a publication's dates.
- Shortening a publication's deadline applies going forward. Gifts and artwork that met the
  previously advertised deadline retain their on-time treatment; do not retroactively mark them late
  because staff moved the date earlier.

- Donations that predate the feature start without a publication assignment. Staff can select and
  include older gifts in a publication; do not automatically assign historical gifts or repeat
  recognition from previously printed programs.

- Each publication date is optional independently. An unset date produces no deadline notice or late
  flag for that category.

## Proposed plan scope for final shared-understanding review

- Add publication setup to Donation Page Settings, with one named publication and two optional
  overall dates. Interpret date-only cutoffs through the end of the Organization-local date.
- Add clear publication expectations to the donation page, checkout summary, receipt email, and
  artwork submission page. Donations and artwork submissions remain available after the dates.
- Add publication and late-status filtering to donation history, with separate late-gift and
  late-artwork labels and an explicit staff action to record inclusion in a named publication.
- Preserve original publication details, handle deadline edits using the confirmed rules, and keep
  older donations unassigned until staff select them.
- Do not add automatic carry-forward, automatic donor emails when staff mark inclusion, or a
  program-layout/printing tool. These are outside the proposed initial implementation scope.

The user confirmed the proposed scope and requested the implementation plan. Implementation was
subsequently authorized in chat. These notes authorize no push, deployment, or hosted changes.
