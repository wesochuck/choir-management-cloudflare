# Seating template import

Seating templates preserve a chart's rows, named singer assignments, and formation definition. They
can seed new charts in an Organization and then be reused through the existing Copy action. This
workflow was requested for the America 250 reference charts; it uses the existing authenticated
seating configuration and chart APIs. Organization schema migration 102 adds template storage.

## Save a reusable template

1. Open Seating and choose **Import**, then select a version 1 seating template JSON file.
2. Leave **Import as** set to **Reusable template**. Select the source chart and template name.
3. Review singer matches. Matching uses names in the current Organization, independent of Active
   status, voice part, and RSVP. Duplicate names offer a selector with voice part, status, and a
   short Profile ID to identify the intended record. Unresolved names retain their original seats.
4. Keep the source formation or select an existing formation, then choose **Save reusable
   template**. Templates do not add charts to a Performance or change attendance. Repeat for other
   source charts.

Templates are stored in the Organization's seating configuration. Their rows, formation snapshot,
singer names, and resolved local Profile IDs survive reloads. Source IDs from portable files are
stripped. Templates are private to Owners and Administrators; member formation reads omit them. An
import retry uses the same template ID. An Organization can store 20 templates, subject to a
combined 1 MB configuration limit and 20,000 named assignments.

## Use a template for a Performance

1. Select the destination Performance and create or select its chart.
2. Expand **Saved templates** and choose **Use …**, or choose **Copy**, then **Saved templates** in
   the source selector. Templates are independent of Venue; copying other Performance charts still
   requires a matching Venue.
3. Review the confirmation's count of unresolved or ineligible assignments. Only Active Profiles
   with a voice part and RSVP Yes are copied. The original template retains all names and seats.
4. Confirm **Copy chart**. The source formation is reused or added without replacing other
   formations. Configure absent sections/voice parts before using a template with them.

Newly matching names are resolved each time a template is used. Explicit duplicate-name choices use
local IDs, including after a rename; nonexistent records fall back to name matching. Neither saving
nor copying a template creates Profiles or changes RSVPs. Delete an unwanted template from **Saved
templates** with confirmation; charts already copied from it remain intact.

## Import directly into a Performance

Choose **Chart for this Performance** in **Import as** to retain the direct import workflow. Select
a formation and resolve eligibility/name issues, or explicitly accept leaving those seats empty.
**Import as new chart** creates a separate live chart. All live chart writes retain server-side
attendance validation and Organization reference checks.

Names are normalized with Unicode NFKC, collapsed whitespace, and lowercase comparison. Automatic
matching requires a unique source name and a unique destination name. Explicit choices cannot assign
a Profile to multiple seats. Source Organization, event, Profile, and Venue IDs never choose
storage.

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

Domain and contract tests cover normalization, explicit choices, collisions, optional template data,
capacity bounds, and performance eligibility. Client and UI tests cover round-tripping names,
validation, authorization failures, template saving, and applying eligible assignments without
changing the source. Browser tests exercise save, reload, use, and delete in both themes on desktop
and mobile. Worker integration tests prove persisted templates, private manager reads, cross-tenant
Profile rejection, backward compatibility, and unchanged live seating checks.

Forward-only Organization migration 102 adds `seating_templates_json` to Organization metadata.
Template writes and formation settings are atomic. The existing Organization export includes this
metadata column. Older clients that omit templates preserve them through the updated server. A
rollback to the old server hides templates; its formation writes leave the separate template column
intact. Restoring the new server makes the saved templates available again. No down migration is
needed, and already copied live charts remain usable. A formation added before a failed chart copy
remains available and is reused on retry.
