# Application CSV Contracts

These contracts govern CSV import and export behavior in the Cloudflare application and are part of
Organization Export. CSV writers must use RFC 4180-style double-quote escaping for dynamic text and
retain the stored value `Idle`; the UI may display that value as “On Break.” Roster-related exports
use the Organization's configured Performer label, with `Performer` as the fallback; imports
continue to recognize legacy `Voice Part` aliases.

| Contract           | Header order                                                                                       | Reference implementation                       |
| ------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Roster             | `Name,Email,Phone,<Performer label>,Status`                                                        | `apps/worker/src/routes/profilesRoutes.ts`     |
| Music library      | `Title,Composer,Arranger,Copies,Catalog ID,Duration,Voicing,Applies To,Genres,Purchase Date,Notes` | `apps/worker/src/routes/musicLibraryRoutes.ts` |
| Event RSVP roster  | `Name,Section,<Performer label>,Event Title,RSVP Status`                                           | `apps/worker/src/routes/eventsRoutes.ts`       |
| Donations          | `ID,Donor Name,Donor Email,Amount,Tribute,Tribute Name,Anonymous,Status,Date`                      | `apps/worker/src/routes/donationsRoutes.ts`    |
| Attendance report  | `Name,<Performer label>,Absences,Presence Count,Total Rehearsals,Attendance Rate %`                | `apps/worker/src/routes/reportsRoutes.ts`      |
| Repertoire history | `Title,Composer,Arranger,Catalog ID,Total Performances,Last Performed`                             | `apps/worker/src/routes/reportsRoutes.ts`      |
| Will call          | `ID,Buyer Name,Buyer Email,Quantity,Paid,Status,Created,Type`                                      | `apps/worker/src/routes/ticketsRoutes.ts`      |

## Structural behavior

- Roster and event RSVP exports append a blank line, a `Section Leaders` marker, the header again,
  and section-leader rows when section leaders exist.
- Event RSVP rows are grouped in Yes, No, and Pending order and preserve the group labels defined by
  the specification.
- Music genres and applicability values are semicolon-delimited inside one field.
- Music import accepts the standard header, quoted commas, escaped quotes, and multiline notes. It
  creates top-level works only, retains existing entries, validates at most 500 rows and 2 MB before
  one Organization-store transaction, and rejects the whole import when any row is invalid.
- Music duration is normalized to seconds in storage and exports as `MM:SS` or `H:MM:SS`. The
  `Voicing` column remains present and blank because configured section applicability is represented
  by `Applies To` in the schema.
- Donations place non-anonymous rows first and insert an `ANONYMOUS DONORS` separator before
  anonymous rows.
- Will-call `Type` is either `Concert Ticket` or `Season Pass (<title>)`.
- Attendance filenames use the performance title with whitespace replaced by underscores.
- Dates, enum spellings, blank fields, quote escaping, filenames, group ordering, and section-leader
  duplication require fixture tests.
