# System communication template parity

The old PocketBase application seeded message templates in its `messageTemplates` collection. The
current Communication Center stores templates per Organization and renders these supported values
when a message is delivered:

`{singerName}`, `{eventTitle}`, `{eventType}`, `{eventDate}`, `{eventLocation}`, `{eventCallTime}`,
`{eventDetails}`, `{setlist}`, `{ticketQuantity}`, `{ticketAmount}`, `{ticketBundleName}`,
`{{RSVP_LINKS}}`, `{{PLAYER_LINK}}`, and `{{TICKET_LINK}}`.

Attendance reports additionally support `{attendanceRate}`, `{presentCount}`, `{totalCount}`,
`{absenteesList}`, and `{thresholdWarningsSection}`.

Audition system templates additionally support `{auditionDate}`, `{auditionTime}`,
`{auditionDateTime}`, and `{auditionLocation}`.

## Brought forward

Migrations 41–46 seed these protected system templates for every Organization that uses the current
schema; migrations 48–49 repeat the audition seed idempotently for Organizations that recorded the
earlier rollout before those templates were available. They appear in **Communications → Templates**
and can be edited for the Organization, but cannot be deleted:

| Template                       | Why it is supported                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| General Announcement           | Static announcement text; no legacy-only token remains.                                                           |
| Dues Payment Notice            | Uses the supported recipient-name token.                                                                          |
| Weather / Schedule Delay Alert | Uses the supported event-title token and supports Email or SMS.                                                   |
| Event RSVP Invitation          | Uses a personalized signed RSVP page link; recipients can respond without signing in.                             |
| Rehearsal Reminder             | Uses the same personalized no-login RSVP page link.                                                               |
| Performance Reminder           | Uses event context, a personalized no-login practice-player link, and a personalized RSVP link.                   |
| Ticket Confirmation            | Uses editable ticket-order wording, ticket totals, and a personalized no-login ticket link.                       |
| Bundle Ticket Confirmation     | Uses editable bundle-order wording, totals, and a personalized no-login ticket link.                              |
| Ticket Concert Reminder        | Uses editable event-reminder wording and a personalized no-login ticket link.                                     |
| Audition Submission Thanks     | Sends the editable acknowledgement after a public audition inquiry is submitted.                                  |
| Audition Confirmed             | Sends the editable confirmation when an audition is scheduled, including the local date, time, and venue.         |
| Audition Reminder              | Sends the editable reminder 24 hours before the scheduled audition, or immediately for shorter-notice scheduling. |
| Event RSVP Follow-up           | Sends one editable email to active Performers whose Performance RSVP is still Pending before the deadline.        |
| Attendance Report              | Finalizes unmarked attendance, renders attendance and linked-Rehearsal warning values, and emails administrators. |

The seed is idempotent and uses stable IDs, so existing Organizations receive the templates once
without duplicating them on later migrations.

The RSVP invitation, rehearsal reminder, performance reminder, ticket templates, and audition
templates are editable from **Communications → Templates**. Ticket confirmations and reminders use
the saved wording when new notifications are queued. Audition submission, confirmation, and reminder
notifications likewise render the Organization’s saved system-template wording when they are queued.
The event-reminder scheduler for member messages selects these templates and queues the normal
Communication Center delivery ledger, so fake, disabled, sandbox, and production modes are visible
and attributable through the same history path.

## Not brought forward yet

These legacy templates are intentionally flagged rather than seeded with broken placeholders. The
new delivery path does not currently provide their required context or automated delivery behavior:

| Legacy template(s)                               | Missing capability in the current project                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| RSVP Confirmation; Free Ticket RSVP Confirmation | Public/member RSVP confirmation workflows do not expose the buyer/event confirmation fields to the Communication Center template renderer. |
| Audition Declined                                | The declined-audition delivery path and its status-specific context are not yet exposed as a Communication Center system template.         |
| Ticket Sale, Donation, and Refund admin notices  | Financial notifications are not yet exposed as editable Communication Center templates.                                                    |
| RSVP Decline Notice                              | The composer does not expose administrator, declined-member, voice-part, or RSVP-note context.                                             |

When those delivery paths expose typed context, the templates can be promoted from this list into
the migration seed without changing the template storage model.
