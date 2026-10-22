# ADR 0062: Keep Contacts when removing a roster Profile

- Status: Accepted
- Date: 2026-10-22

ADR 0061 stores roster email in a linked Contact without creating a login account. Blocking every
linked Contact made newly imported Profiles impossible to delete even when their email had never
been used. Contacts can remain useful independently of roster participation, so permanent Profile
deletion now defaults to **Keep Contacts**: unlink every linked Contact while retaining its email,
preferences, list memberships, communications, purchases, donations, and import history. Archive
continues to remove the Profile from the active roster while retaining both Profile and Contact.

For import cleanup, managers may explicitly choose **Delete unused roster-email Contacts**. Only
Contacts created solely for roster email may be removed with the Profile and their default unknown
preferences. A disposable Contact has source `roster`, no independently maintained first/last name
or phone, and only unknown preferences with source `roster`. Every linked Contact must qualify,
including secondary Contacts and Contacts whose email has since been cleared. List membership,
contact-import history, ticket purchases, donations, and any queued or historical communication
addressed to the Contact prevent cleanup. Non-roster or unknown-source Contacts are preserved.
Rejections identify the blocking category and offer Keep Contacts or Archive Profile.

The roster source is the existing provenance marker; changing it or enriching the Contact makes
automatic cleanup unavailable. Ordinary name/email edits through the roster do not create
independent history. Creation/update audits are retained and do not themselves block deletion.
Clearing roster email still retains the Contact under ADR 0061; explicit permanent deletion with
contact cleanup is the narrow exception defined here.

Both deletion choices preserve existing self-removal, Organization Membership, invite-enrollment,
attendance/RSVP, music-folder, dues/payment, poll, merge, and Profile communication guards. RSVP
history is protected even without a current event roster row. Profile unsubscribe/provider flags and
suppression records, including inactive suppression history, prevent deletion rather than being
erased. Keeping a Contact must not detach it from suppression enforced through its Profile. Such
Profiles require Archive. Kept Contacts retain their own consent and suppression preferences.

The existing authenticated DELETE endpoint accepts the validated `contacts` query option: `keep`
(default for omitted options, including older clients) or `delete_unused`. The same default and enum
are validated at the Organization-store boundary. Unknown choices fail before mutation. The danger
confirmation defaults to Keep Contacts and resets that choice on every opening; cleanup is explicit.
No login account is deleted or created.

All operational checks, unlinks/deletes, and audits occur in one synchronous transaction in the
hostname-authorized Organization Durable Object. Contact unlink/deletion and Profile deletion audits
retain actor and request attribution. Any failure rolls back Contacts, preferences, Profile, and
audits together. There is no provider work, schema migration, or new index. Existing Profile,
Contact, preference, commerce, and delivery indexes support lookups. The contact-import reference
check is a single on-demand scan with a materialized set of linked IDs, not a recurring job or a
scan per Contact.

Rollback restores the stricter code without a schema change; it cannot recover records already
permanently deleted or automatically restore explicitly removed roster links. Production remains
outside this change; no hosted mutation or deployment is implied.
