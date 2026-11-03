# Incomplete checkout reminders — confirmed design interview

Status: Shared understanding confirmed on November 3, 2026. The interview is complete. See the
[implementation plan](2026-11-03-incomplete-checkout-reminders-implementation-plan.md) for the final
implementation contract, responsibilities, and verification. This record authorizes documentation;
application implementation, sending emails, and deployment are separate work.

## Purpose

Help someone who intended to buy tickets or donate but forgot to finish payment. Keep contact
infrequent, optional, and free of pressure. An incomplete checkout is not a debt or a promise to
pay.

## Confirmed decisions

- Send eligible reminders automatically; do not require a separate checkout opt-in checkbox.
- Include an option to stop future incomplete checkout reminders for that email address within the
  Organization. It stops both ticket and donation checkout reminders, including queued reminders,
  and has no automatic expiry. Receipts, ticket confirmations, and newsletter preferences remain
  separate. It does not change preferences in another Organization.
- An existing unsubscribe from the Organization's general emails also suppresses incomplete checkout
  reminders. The reminder-specific opt-out stays separate and does not unsubscribe the recipient
  from general emails. Essential receipts and ticket confirmations retain their existing delivery
  rules; this feature does not bypass provider safety suppressions.
- Each Organization has a setting enabled by default. Owners and Administrators can disable it;
  disabling also stops reminders already waiting to send.
- Only checkouts started after reminders are enabled qualify. Do not backfill historical abandoned
  attempts at feature rollout. Re-enabling the setting covers only checkouts started afterward;
  previously canceled candidates remain canceled. Preserve recipient opt-outs and existing cooldowns
  across setting changes.
- Place the shared setting in Settings → Payments, below the existing online payment controls.
- Send one reminder 24 hours after checkout starts, subject to eligibility checks. Apply a shared
  rolling limit of one reminder per email address per Organization every 30 days across tickets and
  donations; there is no second reminder for the same checkout.
- For the same email address within an Organization, only the newest checkout attempt is a reminder
  candidate, across tickets and donations. It replaces earlier candidates and starts a fresh 24-hour
  wait. Earlier candidates do not resume if the newest attempt completes or becomes ineligible. The
  shared rolling 30-day limit still applies.
- The first version covers individual public ticket purchases, ticket bundles, and donations. Member
  dues are excluded; dues reminders require a separate design.
- A successful donation made after an unfinished checkout cancels its donation reminder when the
  email address and Organization match, even if the amount differs.
- A successful ticket purchase made after an unfinished checkout cancels its ticket reminder when
  the email address and Organization match and the purchase covers the same performance. Different
  quantities and purchases through a bundle count. For an unfinished bundle, a later successful
  purchase covering any included performance cancels the whole bundle reminder, even when other
  performances remain unpurchased.
- Skip ticket reminders when the performance is less than 24 hours away at delivery time. For
  bundles, use the first included performance. Keep the normal 24-hour wait after checkout starts;
  never accelerate a reminder to fit before the cutoff.

- The reminder link restores previous eligible choices on a review page. Show current prices,
  availability, and donation terms before an explicit action starts a fresh payment session. Explain
  changed or sold-out choices and let the person adjust them. Opening the link alone does not start
  payment or reserve inventory.
- Return links expire seven days after the reminder is sent, or sooner when the applicable ticket
  sales close. Expired links show a friendly explanation and a link to the current ticket or
  donation page to start again. Recovery-link expiry must not expire the recipient's separate
  reminder opt-out mechanism.
- Prefill at least the email address from the unfinished checkout on the return form. Treat the
  recovery link as a private bearer link: possession permits viewing that checkout email address,
  including if the recipient forwards it. Do not place the address directly in the URL, log the
  signed link, or expose the return page through shared caching or indexing. A prefilled address is
  not proof of identity and must not grant account access or change communication preferences.
- Restore ticket selections, quantities, donation amount or level, and any discount code alongside
  the prefilled email address. Revalidate prices and discounts before payment. Ask for name and
  postal address again if needed rather than restoring them. Do not restore uploaded artwork onto
  the return page without a separately approved flow.

- Show reminder activity in existing Communications history, labeled **Incomplete checkout
  reminder**. Show the recipient, ticket or donation context, and scheduled, sent, skipped, or
  failed state to authorized staff. Do not add a separate dashboard. Skipped entries should explain
  the reason without exposing signed links or sensitive provider payloads.

- Reminder templates must be editable and support placeholders, with a good gentle default supplied
  by the application. Do not restrict the feature to fixed system wording.
- Always include the return button and **Stop these reminders** link automatically, even when an
  editor removes corresponding placeholders. Keep required sender/footer elements protected too. The
  preview must show the complete composed email, including those protected elements, so staff can
  review what recipients will actually see. Preview actions use inert sample links and do not create
  sessions or change preferences.
- Keep reminder activity in Communications history for 90 days, then remove reminder-specific
  history and saved recovery details. Measure retention from the final sent, skipped, or failed
  state; scheduled work remains subject to bounded eligibility and retry limits. Completed payment
  records retain their existing retention. Preserve recipient opt-outs independently so cleanup
  never re-enables reminders. Expired recovery links stop working at their earlier seven-day or
  ticket-sales deadline even while the history entry remains visible.

## Confirmed template design

Use the existing Communications → Templates editor for separate ticket and donation reminder system
templates, with editable subject and body and the existing reset-to-default affordance. Link to them
from the reminder setting. Preserve Organization customizations across upgrades.

Offer supported placeholders for Organization name, recipient name with a friendly fallback,
checkout summary, relevant event dates, donation amount or level, and the return URL. Match existing
placeholder syntax and rendering conventions; document which fields apply to each template. Preview
with sample values and flag unsupported or context-inappropriate placeholders. Keep private return
URLs out of staff history, generic previews, and logs.

Gentle default wording for implementation:

- Ticket subject: **Your unfinished ticket checkout with {organizationName}**
- Ticket body: You recently started a ticket purchase with {organizationName}, but checkout was not
  completed. If you meant to finish, you can review your selections and current availability below.
  If you changed your mind, no action is needed.
- Donation subject: **Your unfinished donation to {organizationName}**
- Donation body: You recently started a donation to {organizationName}, but it was not completed. If
  you meant to finish, you can review your donation below. If you changed your mind, no action is
  needed. Thank you for considering supporting {organizationName}.

Protected email elements are confirmed: compose the return action, reminder opt-out, and required
sender footer outside editable copy so deleting a placeholder cannot remove them. Render the same
elements in the full-email preview, using sample URLs rather than live recipient credentials.

## Confirmed setting placement

Place one shared **Incomplete checkout reminders** section in **Settings → Payments**, below the
existing online payment controls. Use a **Send incomplete checkout reminders** toggle with help text
explaining that it covers unfinished ticket purchases and donations, sends at most one reminder
after about 24 hours, and lets recipients stop future reminders. Links from the ticket or donation
modules should lead to this same setting.

## Current behavior verified in source

- Stripe payment sessions are created with a 30-minute expiry in
  `apps/worker/src/payments/stripeCheckout.ts`.
- Expiration handlers and `apps/worker/src/organization/paymentCleanupStore.ts` record expired
  payment attempts; they do not schedule recovery emails.
- Donation payment templates provide successful-payment receipts. Ticket reminders concern paid
  purchases and upcoming performances, rather than unfinished checkout.
- No checkout recovery configuration was found in the application request to Stripe. Separate
  provider dashboard settings and the currently deployed version were not inspected.

## First-version behavior

1. Cover individual public ticket purchases, ticket bundles, and donations. Exclude member dues, as
   confirmed.
2. Consider only a persisted checkout that reached the payment step and has an email address. Typing
   an address into an unfinished form alone must not trigger contact.
3. Send at most one gentle reminder 24 hours after checkout starts, as confirmed. The implementation
   plan defines the persisted start event; merely typing in the form is not a checkout.
4. Recheck eligibility immediately before delivery. Suppress if the person has since completed a
   purchase or donation matching the confirmed completion rules, opted out, or is subject to
   existing delivery suppression. Partial overlap cancels the whole unfinished bundle reminder.
5. Apply a shared limit of one reminder per normalized email address per Organization in a rolling
   30-day period, across tickets and donations. Only the newest checkout attempt may qualify, with
   the 24-hour wait measured from that attempt.
6. For tickets, require the event to remain upcoming and sales to remain open with sufficient
   availability. Apply the confirmed 24-hour performance cutoff at delivery, using the first
   included performance for bundles. Require all included performances to remain eligible, as
   detailed in the implementation plan.
7. Offer a safe return link that restores eligible choices for review and creates a fresh payment
   session only after an explicit action. Revalidate current prices, availability, discount rules,
   and donation/publication terms. Do not reserve tickets for 24 hours or silently charge anyone.
8. Provide the confirmed Organization-scoped opt-out for both kinds of checkout reminder without
   suppressing essential receipts or changing newsletter preferences. Existing delivery suppressions
   and general-email unsubscribes also suppress these optional reminders.
9. Use warm, factual language: the process was not completed, they may return if they intended to
   finish, and no action is required if they changed their mind. No countdowns, guilt, or follow-up
   sequence.

## Final shared-understanding confirmation

The user confirmed the complete design on November 3, 2026, including Communications → Templates for
editing, and requested completion of the implementation plan. There are no pending interview
questions. The linked final plan supersedes tentative technical wording in this interview record.

## Implementation constraints for the eventual plan

- Resolve Organization from the validated hostname. Store attempt state, reminder eligibility,
  cooldowns, preferences, and audit history inside that Organization's storage boundary.
- Use selective indexed due-work access with bounded batches. Justify every new index by its query.
- Use the existing durable outbox and queue patterns with stable idempotency keys and bounded
  retries. Keep provider calls outside Durable Object transactions and runtime code.
- Check payment state, preferences, and cooldowns at scheduling and delivery. Account explicitly for
  webhook delays, queue retries, concurrent attempts, and send-versus-payment races; do not promise
  perfect prevention of a reminder during a simultaneous payment.
- Treat recovery links as a distinct signed-link purpose under
  `docs/architecture/signed-link-behavior.md`, with Organization binding, bounded expiry,
  revocation, constant-time verification, and no token logging. A recovery link must not expose
  unrelated patron data or grant access to paid tickets, receipts, or account functions.
- Email security scanners following links must not create payment sessions or change preferences.
  Public preference changes need an explicit, accessible confirmation action.
- Preserve fake/capture behavior locally and preview-side, and staging recipient restrictions. No
  hosted provider configuration, deployment, or production change is part of this interview.
- Any schema changes must use forward-only migrations compatible with the previous Worker version.
  Define a disable path that stops queued reminders as well as new scheduling.
- Coordinate restored donation choices with the separate donation publication-deadline design;
  neither draft silently decides the other's behavior.

## Verification required before implementation is complete

- Focused tests for timing, cross-attempt cooldowns, completion matching, duplicate jobs, opt-out
  after enqueue, delivery suppression, provider failures, and delayed payment webhooks.
- Ticket and bundle coverage for sold-out inventory, closed sales, canceled/past events, and changed
  prices or discounts; donation coverage for changed recognition/publication terms.
- Signed-link adversarial tests, cross-Organization rejection, scanner-safe reads, privacy checks,
  and accessible mobile/desktop return and opt-out flows.
- Appropriate static checks, deployable build and affected integration gates; route verification for
  endpoint changes. Complete release qualification on a clean committed candidate is required before
  any push to main or authorized staging promotion.

## Documentation decisions

The Incomplete Checkout Reminder term is recorded in `CONTEXT.md`. Capture further resolved domain
terms during implementation, preserving existing unrelated edits. Create an ADR only if an agreed
decision has a meaningful reversal cost and a non-obvious architectural trade-off. Routine timing
and copy choices belong in this plan.

The shared-understanding requirement in `.agents/skills/grilling/SKILL.md` is satisfied. Application
implementation has not been requested in this documentation task.
