# Seating template import

Seating templates preserve a chart's rows, named singer assignments, and formation definition. They
can seed new charts in an Organization and then be reused through the existing Copy action. This
workflow was requested for the America 250 reference charts; it uses the existing authenticated
seating APIs and does not require a database migration.

## Import a chart

1. Open Seating and select the destination Performance.
2. Choose **Import**, then select a version 1 seating template JSON file.
3. Select a source chart, give the new chart a name, and review the singer matches.
4. Choose a formation. **Add template formation** preserves the source ordering without replacing
   any existing formation. An equivalent existing definition can be reused. If the template's
   sections or voice parts are absent from this Organization, configure them first or explicitly
   choose an existing formation.
5. Resolve missing or ambiguous names and attendance eligibility before importing. Alternatively,
   explicitly choose to leave unresolved seats empty.
6. Choose **Import as new chart**. Repeat for additional source charts. Use **Copy** to seed other
   charts from the imported arrangement.

Names are normalized with Unicode NFKC, collapsed whitespace, and lowercase comparison. A name must
identify exactly one source singer and one Profile in the current Organization. The destination
Profile must be Active, have a voice part, and have RSVP Yes for this Performance. Import does not
create Profiles or change RSVPs. Source Profile, Organization, event, and Venue IDs are never used
to select destination records; the selected Performance and its current Venue determine the target.

## File format

```json
{
  "format": "choir-seating-template",
  "version": 1,
  "charts": [
    {
      "name": "Reference arrangement",
      "rowCounts": [2, 3],
      "formation": {
        "id": "columns-standard",
        "name": "S–B–T–A columns",
        "isVoicePartLayout": false,
        "sectionOrder": ["S", "B", "T", "A"],
        "strategy": "vertical_column"
      },
      "assignments": [{ "seatKey": "0-0", "name": "Alex Singer" }]
    }
  ]
}
```

Seat keys are zero-based row and seat numbers. Files are limited to 1 MB, 50 source charts, 50 rows
per chart, and 4,000 seats per chart. Duplicate seat keys and out-of-range assignments are rejected.
Roster names belong in a local, ignored folder such as `work/`, rather than committed fixtures.

## Verification and recovery

Domain tests cover normalization, ambiguous names, eligibility, and formation collisions. UI and
browser tests cover review, explicit empty seats, validation, failures, keyboard dismissal, and
desktop/mobile use in both themes. Existing seating integration tests enforce authorization,
Organization isolation, Profile references, and attendance eligibility.

Each import adds a chart and optionally a formation. A chart creation failure leaves the review
open; a formation added before that failure remains available and is reused on retry. Remove an
unwanted chart through the normal confirmed Delete action. Formation removal follows the existing
formation editor's reference checks. Reverting the UI code requires no schema rollback and leaves
already imported charts usable through the standard editor.
