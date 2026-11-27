# Organization Website Editor Access

- Status: Accepted
- Date: 2026-11-26

Owners and Administrators can grant Website Editor access to an existing Organization Member. The
grant preserves the Member role and Profile. An invitation for a Website Editor creates a
website-only Membership without a roster Profile. Revoking that invitation-based access removes the
website-only Membership. Revoking an existing Member's grant preserves their Membership.

Website access covers Pages, Appearance, Labels & navigation, Footer, publication, and public
documents. Owners and Administrators control Tracking because it also applies to ticket pages.
Public document changes take effect independently of website publication.

The canonical-host membership and Organization MFA checks apply to every website operation.
Website-only accounts fail closed at the ordinary Membership authorization boundary. The shell can
read their access status and website module flag. Website editors can preview current draft media
and stage their own website uploads. Website draft saves and document mutations enforce file
eligibility inside the Organization store before referencing any new private file. Only the upload
owner may reclaim an unused scoped upload with the editor grant.

Control-plane migration 0027 expands the Better Auth roles and adds an independent grant column. It
preserves Member and invitation IDs, roster enrollment and Profile reconciliation references, and
existing access. Organization migration 150 adds the private-file scope marker. Existing uploads
retain their prior scope and existing website references remain usable. Use a Website-Editor-aware
rollback artifact to preserve editing and administrative visibility of the new role. An older
runtime rejects website-only roles at its Membership authorization boundary and ignores additive
Member grants.
