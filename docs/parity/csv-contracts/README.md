# Baseline CSV Contracts

These contracts were captured from committed baseline source at
`6874d43a3c3698ae53218a44d17649bc454ca9ac`. They are behavior to preserve in the Cloudflare rebuild
and later become part of Organization Export. CSV writers must use RFC 4180-style double-quote
escaping for dynamic text and retain the stored value `Idle`; the UI may display that value as “On
Break.”

| Contract           | Header order                                                                                          | Baseline evidence                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Roster             | `Name,Email,Phone,Voice Part,Status`                                                                  | `src/services/profileService.ts`, related tests      |
| Music library      | `Title,Composer,Arranger,Copies,Catalog ID,Duration,Voicing,Applies To,Genres,Purchase Date,Notes`    | `src/lib/music/csv.ts`, related tests                |
| Event RSVP roster  | `Name,Section,Voice Part,Event Title,RSVP Status`                                                     | `src/lib/eventRoster/exportCsv.ts`, related tests    |
| Donations          | `ID,Donor Name,Donor Email,Amount,Tribute,Tribute Name,Anonymous,Status,Date`                         | `src/views/admin/DonationsView.tsx`                  |
| Attendance report  | dynamic performer label, then `Voice Part,Absences,Presence Count,Total Rehearsals,Attendance Rate %` | `src/views/admin/ReportsView.tsx`                    |
| Repertoire history | `Title,Composer,Arranger,Catalog ID,Total Performances,Last Performed`                                | `src/views/admin/ReportsView.tsx`                    |
| Will call          | `ID,Buyer Name,Buyer Email,Quantity,Paid,Status,Created,Type`                                         | `src/views/admin/ticketing/TicketingWillCallTab.tsx` |

## Structural behavior

- Roster and event RSVP exports append a blank line, a `Section Leaders` marker, the header again,
  and section-leader rows when section leaders exist.
- Event RSVP rows are grouped in Yes, No, and Pending order and preserve the group labels defined by
  the baseline.
- Music genres and applicability values are semicolon-delimited inside one field.
- Music import accepts the baseline header, quoted commas, escaped quotes, and multiline notes. It
  creates top-level works only, retains existing entries, validates at most 500 rows and 2 MB before
  one Organization-store transaction, and rejects the whole import when any row is invalid.
- Music duration is normalized to seconds in storage and exports as `MM:SS` or `H:MM:SS`. The
  baseline `Voicing` column remains present and blank because configured section applicability is
  represented by `Applies To` in the rebuilt schema.
- Donations place non-anonymous rows first and insert an `ANONYMOUS DONORS` separator before
  anonymous rows.
- Will-call `Type` is either `Concert Ticket` or `Season Pass (<title>)`.
- Attendance filenames use the performance title with whitespace replaced by underscores.
- Dates, enum spellings, blank fields, quote escaping, filenames, group ordering, and section-leader
  duplication require fixture tests before their matrix entries move to implemented.

Approved deterministic fixtures live in `docs/parity/fixtures/`. Runtime code must not import these
documents directly; executable contract fixtures belong in `packages/testkit` when implemented.
