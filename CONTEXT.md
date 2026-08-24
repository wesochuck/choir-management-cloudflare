# Glossary

## Organization

The independently managed performing group that forms the product's tenant boundary. An Organization
owns one roster, event calendar, music catalog, configuration, files, communications, and commercial
records; a person may belong to multiple Organizations with a separate membership and role in each.
_Avoid_: Tenant in user-facing language, Ensemble as a second hierarchy level

## Organization Membership

The relationship that grants a person access to one Organization and carries that person's
Organization-specific role and profile. One identity may have multiple Organization Memberships, and
changing a role or profile in one Organization does not affect the others. A Membership may exist
before it is linked to an Organization Profile; personalized member services require that link.
_Avoid_: Global user role

## Organization Scope

The single Organization selected for an operational request or support action. Roster, event, music,
communication, payment, and other domain operations never query across Organization Scopes;
platform-wide views are limited to account metadata such as plan, usage, and health. _Avoid_:
Cross-Organization operational report

## Organization Timezone

The IANA timezone configured by an Organization for interpreting event dates, RSVP deadlines, and
calendar behavior across member and administrative surfaces. _Avoid_: Device timezone for domain
behavior

## Organization Scale Envelope

The supported planning target for a single Organization: up to 500 roster profiles, 10,000
patron/order/communication records, and 25 simultaneously active authenticated users, with short
public traffic bursts. Expected Organizations are approximately one fifth of this size, and bulk
communications, imports, and reports are asynchronous. _Avoid_: Pricing quota, hard customer limit

## Organization Owner

An Organization Membership role responsible for the Organization's security and commercial boundary,
including billing, ownership transfer, deletion, and Administrator management. Every Organization
must retain at least one Organization Owner, and it may have more than one. _Avoid_: Application
Administrator

## Organization Administrator

An Organization Membership role with full operational control over the Organization's roster,
events, music, communications, configuration, and commercial activity, but not its ownership
boundary. _Avoid_: Platform Administrator, Organization Owner

## Organization Member

An Organization Membership role with self-service access to the member-facing experience. Performer
status, Part assignment, section leadership, and notification responsibilities are profile
attributes rather than Organization Membership roles, and a profile may exist without login access.
_Avoid_: Singer as an authorization role

## Organization Member Dashboard

The member-facing home for an Organization Membership, combining the next relevant events with
member actions and optional Organization offerings such as practice, resources, polls, bulletins,
seating, and dues. It is distinct from My Schedule, which is the detailed event list and RSVP
management surface. For signed-in Organization Members, `/dashboard` is the default post-login
landing page and remains available from member navigation. Organization administrators retain the
Organization Admin Overview as their administrative landing page.

## Organization Profile

An Organization-owned record for a person who participates in its roster or administration. An
Organization Profile may exist without login access and remains separate from the person's global
identity and Organization Membership. _Avoid_: User account, global person profile

## Season

An Organization-defined period used to organize member dues and related participation records. The
Active Season is the period currently open for dues, and its payment status is visible to members.

## Profile Status

The roster availability classification of an Organization Profile: Active, On Break, or Inactive.
Profile Status is distinct from Organization Membership role and event-specific RSVP Status.
_Avoid_: Roster status when the event-specific RSVP Status is meant

## On Break

The user-facing Profile Status for a person who is temporarily not participating while remaining
part of the Organization's roster. The internal value is `Idle` for compatibility with existing
contracts. _Avoid_: Idle in user-facing copy

## Profile Status Automation

A Roster Setting, enabled by default, that may mark an Organization Profile Inactive after three
consecutive missed Performances and restore any non-Active Profile to Active after a future
attending RSVP, unless manual status control is enabled. Automatic recovery is enabled by default.
It automates Profile Status, not RSVP Status. Manual status control may be used for any Organization
Profile, including a Profile used for administration. _Avoid_: RSVP automation Automatic status
changes apply only to Performer-eligible Profiles with a Part assignment and a Performance roster
entry; administrator-only Profiles are not automatically changed. Re-enabling automatic management
immediately evaluates the Profile's existing Performance history. Corrections to past Performance
RSVPs or attendance immediately reevaluate the Profile Status decision. Changing the miss threshold
or related automation setting also immediately reevaluates existing Profiles and previews the
affected transitions before saving. Selecting On Break does not itself enable manual status control;
the separate manual control is the explicit opt-out from Profile Status Automation and the On Break
Timeout. Directly selecting a Profile Status does not silently enable manual control; the Profile
explains that automation may later change the status until the administrator explicitly opts out.
Archived or canceled Performances do not count as missed Performances. An active Performance becomes
eligible for miss evaluation only after it ends, using its scheduled duration when available or the
end of its Organization-local calendar day otherwise.

## On Break Timeout

A separate Roster Setting, enabled by default, that moves an automatically managed On Break Profile
to Inactive after a configured elapsed period, defaulting to one year (365 calendar days). It is
time-based rather than attendance-based, and manual status control exempts the Profile from the
timeout. The timeout has its own enable/disable control, independent of Performance-based Profile
Status Automation. The timer uses Organization-local calendar dates and applies only to
Performer-eligible Profiles; administrator-only Profiles are not timed out automatically. The roster
record shows the calculated date on which the Profile would become Inactive; a manually managed
Profile explains that no automatic transition date applies. Changing the timeout setting immediately
recalculates existing transition dates and previews any Profiles that would become Inactive before
saving. If manual status control is turned off while the Profile remains On Break, manual-exemption
time is not counted and a fresh timeout period begins. For a Profile created or imported already On
Break without a trustworthy prior status timestamp, the timer begins at creation or import.

## Profile Status History

The visible chronological record of actual Profile Status changes. Each entry identifies the prior
and new status, triggering Performance or RSVP Expiry, rule, timestamp, and System automation as the
actor; no-op evaluations are not recorded. _Avoid_: Status log when Organization Audit History is
meant

## Organization Invitation

The manual workflow for granting portal access: an authorized person enters an email address and
Organization Membership role, and the recipient activates or attaches their identity through an
emailed invitation. Administrators do not create or handle another person's password; an
Organization Profile may be created first and invited later. _Avoid_: Public registration,
administrator-assigned password

## Organization Subdomain

The Organization's canonical product hostname, such as `example-chorale.product.com`. It serves the
complete public and authenticated application and remains available when the Organization also
connects a Public Website Domain. _Avoid_: Custom domain

## Public Website Domain

An optional Organization-owned hostname, including an apex domain or `www` hostname, that presents
the Organization's public website, ticketing, donations, auditions, RSVPs, and personalized public
links. Authenticated administration and member access continue on the Organization Subdomain.
_Avoid_: Authenticated application domain

## Portal Sign-In

The invitation-only authentication flow for identities with Organization access. A one-time code
sent to the identity's verified email address is the primary method; a person may optionally
establish and use their own conventional password as an alternative. _Avoid_: Public sign-up,
administrator-assigned password

## Platform Administrator

A platform-level identity authorized to manage all Organizations and platform configuration.
Platform Administrators are outside Organization Membership roles and must use multi-factor
authentication; Organization Owners and Organization Administrators may enable multi-factor
authentication but are not required to do so. _Avoid_: Super admin, Organization Administrator

## Delegated Administration

The routine workflow in which a Platform Administrator selects one Organization Scope and performs
operational administration without impersonating an Organization member. Editing is enabled through
an easy, explicit elevation for the current scope, remains visibly identified as platform activity,
and attributes every change to the Platform Administrator. _Avoid_: User impersonation, exceptional
support access

## Organization Audit History

The Organization-visible record of administrative changes, including actions performed through
Delegated Administration. It identifies the real actor, time, action, and affected record; private
platform notes, billing-risk flags, and abuse investigations are not part of this history. _Avoid_:
Impersonation log, private platform operations log

## Connected Payment Account

The Organization-owned payment-processing account that receives its ticket, donation, dues, and
bundle revenue. The Organization is the merchant of record and owns processing fees, refunds,
disputes, reporting, and negative-balance liability; the platform never receives or commingles this
revenue. One Connected Payment Account is shared by the Organization's enabled payment modules.
Stripe webhook events identify this account and resolve to exactly one Organization before any
operational transition. _Avoid_: Platform payment account, shared Stripe account

## Payment Attempt

A single provider Checkout Session and its tenant-local payment state for one ticket order,
donation, or dues obligation. A Payment Attempt starts as `pending`, becomes `paid` only from a
verified provider event, may become `expired`, and may become `refunded` only through the refund
workflow. Retries create a new Payment Attempt and preserve the old attempt for audit; they never
reuse an expired provider session. _Avoid_: Browser success, payment redirect, reusable checkout
session

## Payment Activation

The explicit Organization-level decision to accept live online payments for one enabled module:
Tickets, Donations, or Dues. It is separate from Connected Payment Account onboarding, defaults off,
is available only to Organization Owners and Administrators (or a scoped Platform Administrator),
and is blocked unless the platform, webhook, connected account, and communications readiness checks
pass. _Avoid_: Stripe onboarding, automatic payment enablement

## Payment Lifecycle

The shared payment state machine: `pending` means a Checkout Session exists but payment is not
verified; `paid` means a verified completion was applied; `expired` means the Checkout Session
closed without payment; and `refunded` means a verified provider refund was applied. A browser
return page is informational and never changes lifecycle state. _Avoid_: Client-confirmed payment,
success URL

## Manual Donation

A donation recorded directly by an Organization Administrator (for offline payment methods such as
check, cash, bank transfer, or offline card) that is immediately created in `paid` status without
initiating an online checkout session. A manual donation may omit the donor email address and does
not attempt external payment gateway refunds when refunded or voided. _Avoid_: Offline charge,
simulated checkout

## Thank-You Letter Status

The trackable acknowledgment state of a donation record indicating whether and when a formal donor
acknowledgment, tax receipt, or thank-you letter was issued by the Organization. It applies to both
online and manual donations and can be toggled by Organization Administrators without altering
financial accounting records. _Avoid_: Automated receipt when referring to physical/formal
acknowledgment letters

## Platform Access

The free, Platform Administrator-provisioned right for an Organization to use the software. Modules
are enabled as product configuration rather than paid entitlements, and the platform has no plans,
trials, subscriptions, or usage billing. _Avoid_: Platform Subscription, paid plan, billing
entitlement

## Platform Transactional Email

A security or system message sent by the platform, including Portal Sign-In codes, Organization
Invitations, security alerts, domain-verification notices, and system failures. It uses a
platform-owned sending domain and is operationally separate from Organization Communications.
_Avoid_: Newsletter, event campaign, Organization announcement

## Organization Communications Provider

The Organization-owned communications service and verified sending identities used for campaign
email and SMS, including newsletters, event invitations, reminders, and combined Email/SMS sends.
Organizations connect their own provider account so sending cost, branding, consent, suppression
behavior, and reputation remain isolated; Brevo is the initial supported provider. _Avoid_: Platform
Transactional Email, shared platform campaign sender, platform-funded SMS

## Organization Custom Email Domain

A dedicated sending subdomain (e.g., `mail.seattlechorus.org`) configured by an Organization for its
outbound communications, event reminders, ticket receipts, and announcements. It is verified via DNS
records (SPF, DKIM, DMARC, and bounce routing) while delivered through Cloudflare Email Sending.
_Avoid_: Apex domain for mass sending, platform auth sender replacement

## Organization Reply-To Email

An Organization-configured contact email address (e.g., `info@seattlechorus.org`) attached as the
`Reply-To` header on all outbound Organization Communications. It allows members and patrons to
reply directly to organization directors or staff regardless of whether a custom sending domain is
active. _Avoid_: Unmonitored no-reply address when member replies are expected

## Functional Parity Release

The first production release of the Cloudflare application, which must include every current product
module and all current user-visible behavior and visual character. Internal implementation phases
are engineering milestones only and do not authorize a partial production launch; the release begins
with empty Organization data rather than migrating PocketBase records. _Avoid_: Minimum viable
product, phased production launch, data migration

## Parity Baseline

The current PocketBase application at commit `6874d43a3c3698ae53218a44d17649bc454ca9ac`, used as the
stable behavioral and visual reference for the Functional Parity Release. Executable code and tests
establish implemented behavior; non-PocketBase `AGENTS.md` rules remain normative, while design and
plan documents provide intent and acceptance details but are not by themselves proof that a proposed
feature exists. _Avoid_: Moving target, treating every historical plan as implemented scope

## Parity Bridge

The development-only, read-only relationship between the new `choir-management-cloudflare`
repository and the Parity Baseline repository. Local AI tools may inspect both sibling repositories,
while approved contracts, fixtures, screenshots, CSV formats, glossary entries, and ADRs are copied
into the new repository so its tests, builds, deployments, and runtime never depend on legacy source
availability. _Avoid_: Runtime cross-repository import, production dependency, mutable legacy
reference

## Environment Promotion

The release process in which one commit and lockfile deploy automatically to an isolated permanent
staging environment, passes integration and parity gates, and is then approved for deployment with
production bindings. Staging and production never use separate code branches or manual file
transfer, and production retains a known-good Worker version for rollback. _Avoid_: Staging branch,
cherry-picked production release, shared staging/production data

## Organization Scheduler

The alarm state owned by one Organization's Durable Object. It records the next due Organization
work, wakes only that Organization, creates idempotent jobs for reminders, reports, checkout
cleanup, and queued communications, and advances its alarm after the transaction commits. External
delivery and retry execution occurs through queues rather than inside the alarm. _Avoid_:
Platform-wide operational scan, one global tenant cron loop

## Delivery Job

An idempotent unit of asynchronous work for exactly one Organization, such as sending one email or
SMS, generating an attendance report, or reconciling a payment event. Queue delivery is treated as
at-least-once, so the Organization store records a stable idempotency key and terminal outcome
before repeated delivery can cause another side effect. _Avoid_: Exactly-once assumption,
cross-Organization batch

## Published Projection

A read-optimized, cacheable representation of an Organization's public website, public event,
ticket, donation, audition, RSVP, or player data. The Organization store remains authoritative;
publishing a relevant change produces a new projection version so public traffic can be served at
the edge without making every request contend on the Organization's Durable Object. _Avoid_: Second
source of truth, editable cache

## Visual and Interaction Parity

Preservation of the Parity Baseline's recognizable visual character, responsive behavior,
accessibility, interaction safety, and user workflows without preserving its frontend source code or
component library. Semantic theme tokens, responsive table/card behavior, mobile dialogs,
confirmation patterns, and meaningful loading/error/empty states are part of parity. _Avoid_:
Pixel-for-pixel source reproduction, retaining Shoelace solely for implementation continuity

## Structured Public Website

The Organization's configurable public experience on its Public Website Domain: branded hero
content, About and History Markdown, featured and past performances, and module-aware navigation to
performances, tickets, donations, and auditions. It is driven by Organization content and product
records rather than arbitrary pages, posts, or a drag-and-drop page builder. _Avoid_:
General-purpose CMS, blog platform, custom page builder

## Organization Export

A portable ZIP archive of one Organization's settings, operational records, audit history, and
uploaded files, available to its Owners and Platform Administrators. It reuses the Parity Baseline's
established CSV contracts for roster, music library, event RSVP roster, donations, attendance,
repertoire history, and will-call data, and adds JSON only where CSV would lose structure; the
Functional Parity Release does not include Organization deletion, timed recovery, automated purge,
restoration, or whole-archive import. _Avoid_: Platform-wide export, backup-and-restore system

### Example Dialogue

> **Administrator:** I help manage two choirs that use the application separately. **Developer:**
> Those are two Organizations. You can use one identity to belong to both, while each Organization
> keeps its own roster, settings, and records. **Support:** I need to investigate an event-delivery
> problem. **Developer:** Enter that Organization's scope first; support tools do not search message
> or roster data across Organizations. **Director:** Our accompanist needs portal access but does
> not sing. **Developer:** Give them an Organization Member membership without a Part assignment;
> Performer eligibility remains a profile attribute. **Administrator:** I want to add the whole
> roster before everyone needs an account. **Developer:** Create their Organization Profiles now,
> then send Organization Invitations only to the people who need portal access. **Owner:** We want
> `examplechorale.org` to be our public website. **Developer:** Connect it as the Public Website
> Domain; account management and the member portal remain at your Organization Subdomain.
> **Member:** I would rather use a password than request a code each time. **Developer:** Add your
> own password to the identity and choose “Use password instead” during Portal Sign-In. **Owner:**
> Do I need multi-factor authentication to manage my Organization? **Developer:** It is optional for
> Organization roles but mandatory for every Platform Administrator who can manage Organizations
> globally. **Platform Administrator:** I am handling this Organization's event setup today.
> **Developer:** Enter its Organization Scope and enable editing; every change remains attributed to
> your Platform Administrator identity. **Owner:** Did our Administrator or the platform change this
> event? **Developer:** The Organization Audit History shows the actual actor and the affected
> event. **Treasurer:** Where does a ticket buyer's payment settle? **Developer:** It goes directly
> to the Organization's Connected Payment Account; Platform Access is free and never participates in
> that transaction. **Administrator:** Can the platform send our event newsletter from its
> login-code address? **Developer:** No. Connect the Organization Communications Provider and its
> verified sending identity for campaigns. **Owner:** Can we launch the new application after only
> roster and events are ready? **Developer:** No. Those are internal milestones; the Functional
> Parity Release waits for every current module and workflow. **Developer:** A historical plan
> describes an extra workflow that is absent from the code and tests. **Owner:** Treat it as design
> context, not parity scope, unless we deliberately add it to the new product. **Developer:** I need
> to compare the rebuilt RSVP flow with the baseline. **Owner:** Use the Parity Bridge to inspect
> the pinned repository, then capture the approved contract in the new repository. **Owner:**
> Staging passed. What changes when we release? **Developer:** Environment Promotion deploys the
> same tested commit with production resources and secrets. **Designer:** The rebuilt dialog uses a
> different component primitive but looks and behaves the same. **Developer:** That satisfies Visual
> and Interaction Parity when responsiveness, accessibility, and safety behavior also match.
> **Owner:** Can I publish an arbitrary blog inside the public site? **Developer:** Not in the
> Functional Parity Release; the Structured Public Website focuses on the Organization's existing
> content and public modules. **Owner:** I need a copy of everything our Organization has stored.
> **Developer:** Generate an Organization Export; it contains only that Organization's records and
> files.

## First-Run Setup

The resumable initialization journey for one Organization. A Platform Administrator may create,
configure, and launch the Organization before any Owner activates an account; invited Owners may
later continue or revise Organization settings, enabled Modules, integrations, initial data, and
readiness work.

## Organization Launch

The explicit transition that opens an Organization's enabled public and authenticated product areas
after required First-Run Setup items are complete. Organization Launch is independent of whether an
invited Owner has activated an identity; optional or integration-dependent Modules may remain
unavailable until their own readiness checks pass.

## Legacy Application Administrator

The Parity Baseline's global PocketBase administrative-user role. It informs behavior to preserve
but is replaced in the Cloudflare model by Organization Owner, Organization Administrator, and
Platform Administrator. _Avoid_: Application Administrator as a new authorization role

## Module

A product capability that an organization may enable or disable without deleting its existing data.
A disabled Module is intentionally unused rather than incomplete.

## Readiness Item

A measurable setup task associated with System Configuration or a Module. It is complete,
incomplete, or not applicable when its owning Module is disabled.

### Example Dialogue

> **Owner:** We do not sell tickets, so Ticket Sales should not keep First-Run Setup incomplete.
> **Developer:** Disable that Module. Its Readiness Items become not applicable, its data remains
> intact, and you can enable it later from System Settings. **Owner:** I still need to configure
> email for Communications. **Developer:** Leave Communications enabled; its verification stays as
> an incomplete Readiness Item after launch. **Platform Administrator:** The invited Owner has not
> activated an account yet. **Developer:** You may still complete First-Run Setup and perform
> Organization Launch; the Owner can join later.

## Performer

An Organization Profile with a Part assignment and therefore eligible for performer-specific
workflows. Each Organization may configure the person-facing label, such as Singer, Musician, or
Performer. _Avoid_: Part when referring to a person

## Part

An Organization-defined assignment classification for a Performer, such as Soprano 1 or Bass 2. Each
Part has a short label, a descriptive full name, and a Section Bucket. _Avoid_: Performer when
referring to the assignment, Voice Part in user-facing language

## Personalized Magic Link

A secure, uniquely generated URL sent to a singer that allows them to perform a specific action
(e.g., RSVP, respond to a poll, access the music player) without requiring a standard password
login. These links use signed tokens to verify the singer's identity and the intended action.

## Engagement Poll

A targeted question sent to singers via Personalized Magic Links to gather volunteers or information
for specific event-related tasks (e.g., moving risers) or organizational needs (e.g., general skill
sets). Polls are created directly within the Communications interface during message composition.
Singers can toggle or edit their responses at any time via their personalized link.

## Voluntary Assignment

A record of a singer's affirmative response to an Engagement Poll. These assignments allow
administrators to track volunteer names and total counts to assess organizational capability for
specific tasks.

## Polls Dashboard

A central administrative interface for reviewing responses to Engagement Polls. The dashboard
provides an overview of total response counts and option distributions directly on the main view,
along with a detailed Results view displaying option tallies, percentage distributions, and
identified respondent rosters (including singer display names, voice parts, and submission
timestamps) with CSV/list export capability. To protect audit integrity, poll option structures are
locked once responses have been recorded. Event-linked polls are grouped by performance/rehearsal
and automatically archive when the event passes.

## RSVP Status

The attendance response provided by or assigned to a singer for a specific event. Can be:

- **Yes (Attending)**: Singer expects to perform or rehearse.
- **No (Declined)**: Singer is unavailable.
- **Pending (No Response)**: The default status indicating no selection has been made yet.

## RSVP Expiry

The Organization rule that converts a Pending RSVP for a Performance to No at a configurable number
of calendar days before the Performance starts, defaulting to seven days. The calculated deadline is
shown on the event, and remains open through the end of that displayed date in the Organization's
timezone. Rehearsal RSVPs do not use RSVP Expiry. The lead time is an Organization-wide Roster
Setting, and the event links back to that setting. _Avoid_: RSVP automation when the deadline rule
is meant. If a Performance is created inside the lead-time window, its deadline is already passed;
the event-creation flow warns the administrator and does not create a hidden grace period. When RSVP
Expiry produces No, that result counts as a missed Performance for Profile Status Automation and is
identified as automatic in Event RSVP History. RSVP Expiry has its own enable/disable control; when
disabled, Pending RSVPs remain Pending. Changing the lead time immediately recalculates deadlines
and previews any Pending RSVPs that would become overdue before saving. Expiry does not send a new
notification when it converts a response; existing RSVP reminders include the calculated deadline,
and the automatic conversion is retained in Event RSVP History. Archived or canceled Performances
are excluded from RSVP Expiry. After the deadline, member RSVP self-service is closed;
administrators may override the response with an audited change, and later Present attendance may
still reconcile the RSVP to Yes.

## Event RSVP History

The visible chronological record of RSVP Status changes for an event roster entry, including the
prior and new response, reason, timestamp, and whether the change was automatic. It is separate from
Profile Status History, which records only changes to an Organization Profile's roster status.
_Avoid_: Profile Status History for event responses

## Attendance Reconciliation

When an Organization Profile is recorded Present for a Performance or a Rehearsal linked to a
Performance, the RSVP Status for that attended event is reconciled to Yes. Present attendance for a
linked Rehearsal also reconciles the parent Performance RSVP to Yes because rehearsal attendance
means the Profile is committed to that Performance. Attendance is the stronger evidence when it
conflicts with an earlier RSVP response. Absent attendance does not rewrite RSVP Status; RSVP
continues to represent the person's stated intention while attendance represents the outcome.

## Folder Number

The Organization's identifier for a physical music folder assigned to an Organization Profile for
one Performance. It may contain letters or punctuation, is case-insensitively unique within that
Performance, and may be reused for another Performance. _Avoid_: Folder ID

## Folder Return Status

The per-Performance state of an Organization Profile's assigned music folder: Returned, Outstanding,
or Not Assigned. Returned is an Organization Administrator's confirmation of physical receipt; Not
Assigned has no active return obligation and is excluded from return-rate calculations. _Avoid_:
Missing folder as a synonym for Outstanding, member self-report

## Music Folder Report

A report over selected Performances that summarizes Folder Return Status by Organization Profile and
exposes the underlying Performance-scoped assignments. Profiles without an assigned Folder Number in
the selection do not appear, and totals count Profile-by-Performance assignments rather than unique
Profiles. _Avoid_: Folder accountability report, complete roster folder census

## RSVP Balance

A real-time breakdown of RSVP statuses grouped by Parts. This allows directors to quickly identify
imbalances (e.g., zero or low Tenor 1 attendance) before rehearsals or performances.

## RSVP Decline Notice

An automated email notification sent to administrators who have opted to receive alerts when a
singer declines a rehearsal or performance RSVP. It includes the singer's name, Part, the event, and
any reason or note provided by the singer.

## Catalog Lookup URL Template

A configurable URL format defined in settings that enables automatic linking of music piece Catalog
IDs to external publisher/sheet music databases (e.g. J.W. Pepper). The placeholder `{catalogId}` is
replaced dynamically with the piece's specific catalog number to build the hyperlink.

## Reference Recording

An audio track (typically MP3) attached to a piece in the Music Library. Used by administrators for
archive management and made available to singers for practice and learning when the piece is
included in their set list.

## Practice Player Link

A signed, Organization-bound, shareable event link that lets anyone with the link open approved
event practice tracks without a standard login. It exposes published event practice content only,
not member-specific Profile details, and remains limited by its purpose, event, and expiry. An
Organization reuses one link for the event until it expires or an administrator rotates it. The
default lifetime is 180 days and is configurable per Organization in Music Library settings.
Rotation immediately revokes the prior link and starts a fresh lifetime for the replacement. Access
also re-checks event eligibility: a canceled or archived event, or an event whose approved Set List
was unpublished, shows an unavailable state instead of serving practice audio.

## Set List

A curated sequence of music pieces and intermissions scheduled to be performed or rehearsed at a
specific event. It displays song titles, composers, durations, running timestamps, and linked
practice audio, and can be approved by administrators to be visible to singers on their dashboard.
An approved Set List may have partial practice-track coverage; one published playable track is
enough to make Practice available while missing tracks remain unavailable. A linked Rehearsal uses
its own approved list when present and otherwise inherits the parent Performance's approved list.
When that inherited list is used, the Rehearsal reuses the parent Performance's stable Practice

## Linked Rehearsal RSVP

The participation state for a Rehearsal that is linked to a parent Performance. When a member is
attending the parent Performance (either `Yes` or unanswered `Pending`), linked Rehearsals appear on
the Member Dashboard and My Schedule, inheriting the parent Performance's RSVP by default. A member
may override individual Rehearsals by marking themselves as declined (`No`), which strictly requires
providing a note explaining the reason for absence. If a member explicitly declines the parent
Performance (`No`), all linked Rehearsals are hidden from their member schedule and dashboard.

## Featured Number

A song on an event's **Set List** that highlights an ordered set of **Performer Credits**. It is
presented as a Solo when it has one credit, a Group when it has multiple credits, or Performers TBA
when it has none. _Avoid_: Solo / Small Group flag

## Featured Assignment

The member-facing notice that an Organization Profile is explicitly credited on an approved Featured
Number for an upcoming event. It may be shown before RSVP and may be inherited by a linked Rehearsal
from its parent Performance; it is distinct from exposing the complete Set List.

## Performer Credit

The stable public name of a roster performer or guest attached to a **Featured Number**. Credits
retain their billing order and captured names so an event's published program remains historically
accurate. _Avoid_: Cast member, assignee

### Example Dialogue

> **Director:** This piece is a Featured Number for Morgan, with guest artist Riley listed second.
> **Developer:** I’ll add two Performer Credits in that billing order, so the Set List presents it
> as a Group. **Director:** The soloist for the next performance is not chosen yet. **Developer:**
> That Featured Number can remain Performers TBA until its Performer Credit is selected.

## Multi-Work Piece

A sheet music catalog record representing a compound musical work consisting of multiple distinct
sections or movements (e.g. masses, cantatas, or oratorios).

## Section Bucket

A top-level classification used to group related Parts (e.g., "Sopranos" as a bucket for "S1" and
"S2"). These buckets serve as the primary units for standard seating distribution, filtering, and
visual identification throughout the application.

## Seating Formation

A global, reusable configuration template managed in system settings that defines the layout
strategy (Columns or Rows) and the sequence of categories (either Section Buckets or Parts) used by
the auto-paint engine to fill stage layouts. Can optionally be configured in "Part Layout" mode to
lay out and mismatch-check by exact Parts instead of top-level Section Buckets.

## Seating Column

A vertical slice of a seating layout extending from the front row to the back row across all tiers.

## Seating Row

A horizontal tier of seats on a stage layout arranged sequentially from front to back.

## Distinct Section Palette

A predefined set of high-contrast color values assigned to Section Buckets and Parts to guarantee
clear visual separation on seating charts and grid layouts.

## Unassigned Singer Dock

A shelf at the bottom of the seating chart containing active singers who have not yet been assigned
to a seat. It dynamically groups unassigned singers into columns/lanes matching the active formation
(either Section Buckets or Parts), displaying only the categories that are present in the formation.

## Automated Reminder

A scheduled outbound message automatically triggered before an event starts. Configured on a
per-event basis via an `enableAutomatedReminder` flag and a `reminderLeadTimeHours` lead time.
Dispatch state is tracked via a `reminderSentAt` timestamp to prevent duplicate sends. Reminders are
exclusively sent to active singers whose RSVP Status is "Yes (Attending)" for the target event
roster. For Rehearsals linked to a parent Performance, the Rehearsal's own RSVP list is completely
ignored, and reminders are instead sent to the "Yes (Attending)" roster of the parent Performance.

## Pending RSVP Follow-up

A one-time, email-only message sent to active Profiles whose Performance RSVP Status remains
"Pending (No Response)" 48 hours before the Organization's RSVP deadline by default. It is distinct
from an Automated Reminder, which is sent to confirmed attendees, and linked Rehearsals inherit the
parent Performance's follow-up rather than generating a duplicate.

## Attendance Report Warning Threshold

The independent Organization setting that determines when a post-event Attendance Report or the
Organization Member Dashboard warns about missed linked Rehearsals. The default is one missed
Rehearsal; it does not change Profile Status Automation's separate consecutive-missed-Performance
threshold.

## Communication Delivery Mode

The environment-controlled external-effects policy for Organization communications: Fake records
deterministic sends without contacting a provider, Disabled records suppressed deliveries without
sending, Sandbox uses provider test restrictions, and Production may contact the configured
provider.

## Attendance Report

A post-event summary automatically generated and sent to administrators after a rehearsal or
performance. It provides attendance rates, absentee lists, and threshold warnings based on the
recorded roster. Normal recipients are opted-in Owners and Administrators; when none are eligible, a
reachable, non-suppressed Organization Owner is used as the fallback.

## Communication History

A central log of all dispatched messages, including manual bulk emails/SMS and those triggered by
automated system tasks.

## Member Bulletin

A recently dispatched Organization Communication addressed to a specific Organization Member and
shown in that member's dashboard. A Member Bulletin is not a draft, an undelivered message, or a
read/unread record.

## Message Draft

A partially composed or unsent message that is saved to the database (with a status of "Draft") for
future refinement, recipient filtering, and dispatch.

## Message Template

A reusable layout or pre-written text block containing placeholders. Templates can optionally have a
`systemRole` (e.g., 'performance_reminder', 'rehearsal_reminder') allowing background tasks to
automatically locate and dispatch them without manual selection.

## Event Cloning

A function that duplicates an existing Performance, copying its title, date/time, details, and venue
into a new event record with RSVPs (Event Roster responses) copied over, while keeping the set list
empty, setting attendance/folder stats to default, and keeping its initial RSVP state closed.

## Seating Chart

A physical arrangement of singers in rows and columns on a stage or venue layout. A single
performance can support multiple distinct seating charts, each identified by a custom user-defined
name (e.g., "Chamber Choir", "Combined Finale"). Each seating chart is linked to a Seating
Formation, which dynamically filters the unassigned singer pool and available seats to match only
the Parts or Section Buckets specified in that formation.

## Standing Neighbors HUD

A user interface component in the seating finder that displays the names and Parts of the immediate
standing neighbors (Left, Right, Behind, In Front) relative to the singer's assigned seat.

## Seating Grid Mirroring

A layout rendering strategy for the stage finder that positions Row 1 (the physical front row of the
stage, closest to the director and audience) at the bottom of the screen, and the last row (the
physical back row/tier) at the top of the screen, aligning with a singer's forward-facing
perspective looking toward the podium.

## Performance Recency

The elapsed time since a music piece was last performed. In the music library, this is calculated
dynamically using the date of the most recent linked performance event.

## Performance Recency Filter

A search control in the music catalog that filters pieces based on how recently they were performed
(e.g. within the last 1, 2, or 3 years, not performed for over 3 or 5 years, or never performed).

## Composer

The individual(s) who wrote the original musical work. Stored in the `composer` field of a music
library piece.

## Arranger

The individual(s) who adapted or arranged the original musical work for a specific vocal setting or
instrumentation. Stored in the new `arranger` field of a music library piece.

## Calendar Subscription Feed

A secure, personalized iCalendar (.ics) feed URL that allows singers to sync their choir event
schedules (including rehearsals and performances) directly into external calendar applications.

## Calendar Salt

A unique, cryptographically random string stored on a singer's profile that is signed into their
Calendar Subscription Feed URL. Re-generating this salt instantly invalidates any previously shared
subscription links.

## Auditions & Inquiries

The prospective singer intake management system allowing an Organization to accept either audition
requests or open join inquiries from interested singers.

## Intake Mode

An Organization-level configuration governing whether prospective singers must schedule an audition
(`audition` mode) or can submit an interest form without an audition (`open_inquiry` mode).

## Audition Inquiry

A request submitted by a prospective singer via the public audition form, detailing their name,
contact information, preferred audition time slot, Part, and musical experience.

## Open Join Inquiry

A request submitted by a prospective singer when the Organization operates in open inquiry mode,
detailing their name, contact information, preferred or tentative Part (including an option for
undetermined voice placement), musical experience, and notes.

## Rehearsal Schedule

A structured schedule configuration (regular days of the week, start and end times, venue, and
seasonal notes) presented to prospective singers on the public intake form to set rehearsal
attendance expectations.

## Singer Resource

A document (such as a PDF handbook) or an external hyperlink (such as a Google Drive folder) managed
by administrators and made available to all active singers under the Resources section of their
dashboard.

## Ticket Bundle

An administrative grouping of multiple upcoming performances offered for sale as a single package
(e.g., a "Season Ticket"). A bundle defines its own single, fixed price, total capacity, and public
marketing details. The effective available capacity of a bundle is strictly limited by the lowest
remaining capacity of any individual performance included in the package, preventing accidental
overselling of popular events. A bundle automatically expires and becomes unavailable for purchase
once the first included performance has occurred.

## Season Ticket

A bundled purchase option that allows a buyer to purchase admission to a defined set of upcoming
performances in a single transaction. Upon successful checkout, the system automatically generates
individual standard Will Call Ticket Purchase records for each included performance, ensuring
compatibility with existing door-entry, capacity, and communication logic. These individual records
are linked by a shared Stripe transaction ID, meaning refunds are processed on an all-or-nothing
basis for the entire package.

## Will Call Ticket Purchase

A record of a successful general admission ticket transaction for a Performance, detailing the
buyer's name, email, purchased quantity, payment status, and Stripe session reference. Used by
administrators to manage door admission via a printed or digital will call list.

## Ticketing Configuration

Settings defined on a Performance event that enable ticket sales, set the single ticket price, and
specify the maximum ticket capacity for the event.

## Advance Ticket Price

The price charged for a ticket purchased online in advance of the performance day.

## Day-of Ticket Price

The higher price charged for a ticket purchased online on the day of the performance.

## Discount Code

A buyer-entered code that applies either a whole-percentage discount from 1% through 100% or a fixed
per-unit currency discount to exactly one Performance's tickets or one Ticket Bundle. A fixed
discount applies to each ticket or purchased Bundle, never to each admission within a Bundle; a
Performance code applies to the active advance or day-of price. _Avoid_: Site-wide discount,
multi-item code, stacked discount

## Discount Code Availability

The redeemability of a Discount Code while its linked sellable item is available, including a code
prepared before sales open. Deactivation blocks new checkouts but preserves the quoted terms of an
already pending checkout; codes are case-insensitive, ignore surrounding whitespace, and are unique
in normalized form within an Organization. _Avoid_: Independent discount sale window

## Discount Code Redemption

One confirmed checkout's use of a Discount Code, regardless of the number of ticket or Bundle units
purchased. A code may have an optional Organization-wide total limit; a limited redemption is
reserved during pending checkout, confirmed on paid or complimentary completion, released when
checkout fails or expires, and not restored by a refund. _Avoid_: Per-person anonymous-code limit,
per-ticket redemption count

## Discounted Ticket Order

A Ticket Order with one Discount Code applied; it preserves immutable code and pricing details,
including the original subtotal, discount, discounted subtotal, fee, and final total. Fees are based
on the discounted subtotal, every unit floors at $0, and a $0 order is a capacity-consuming
Complimentary Ticket Order with no processing fee. _Avoid_: Credit, negative ticket price

## Discount Code Management

The Organization Owner and Organization Administrator capability to create, edit, deactivate, and
report on Discount Codes, with every change in Organization Audit History. A code is editable until
its first confirmed redemption and then may only be deactivated; management reports redemption count
and discounted revenue, while door-facing will-call lists omit discount details. _Avoid_: Buyer code
administration

## Discount Code Checkout

The ticket or Bundle checkout affordance that shows a code field only when the linked sellable item
has a currently redeemable code, without exposing code values or redemption data. At most one code
applies per checkout; all rejected codes present the same buyer-facing message, and confirmations
and receipts itemize the code, original subtotal, discount, fee, and final total.

## System Configuration

Organization-wide, infrastructure-level settings reserved for the central `SettingsView`. Examples:
`choirName`, SMTP server, payment gateways, global auth providers. Stored as key-value entries in
the `appSettings` PocketBase collection. Any new entry requires a corresponding forward migration.

## Feature Configuration

Settings that configure a specific feature's behavior or define templates/presets for that feature.
Configured directly inside the relevant product view under a settings/config tab, NOT in the global
`SettingsView`. Examples: Roster Settings (Parts, Season, Section Buckets & Colors) inside
`RosterView`, Music Catalog Settings (Genres, Catalog URL Lookup) inside the Music Library, Seating
Formations Templates inside `SeatingView`. Draft state is managed with a `FloatingSaveBar` and
persisted via `dialog.confirm`/`dialog.showMessage` flows.

## View Preferences (Server-Side User Preferences)

Personal, per-user view state (sorting selections, view modes, personal filters) stored on the
`users` collection in a flexible JSON field named `preferences`. Never clutter the administrative
system settings database with these. Exposed and configured in a single "View Preferences" section
of the user's `ProfileView` so both singers and admins can manage device-spanning view behavior in
one hub. Type-safe merging lives in `src/lib/userPreferences.ts`, and `useAuth()` exposes
`updatePreferences(partialPreferences)` for writes. Feature views should load preferences with
sensible local defaults and trigger seamless persistence on change, without showing verbose
"preference saved" banners.
