# Section-only roster assignments

Accepted: Organizations choose Sections only or Sections with parts in Roster Settings. A performer
has an assignment to a Section in the first structure or a Part in the second. Existing
Organizations retain Sections with parts when the setting is absent.

Keep the existing `voicePart` assignment field and project assignable Sections into `voiceParts` as
one entry per Section (code, name, parent code). This preserves performer eligibility, CSV/API
compatibility, and consumers such as seating, attendance, invitations, and communications without
introducing two competing assignment sources. Track-only Sections do not produce assignments. The
API derives this projection; clients cannot define separate Parts in section-only mode.

Changing to Sections only transactionally maps existing Profile assignments to their Part's parent
Section. Reject changes that would orphan assigned Profiles. Explain before saving that previous
subdivisions are collapsed; switching back retains the section assignments as initial Parts rather
than attempting to infer the old subdivisions. No SQL schema migration is required. Older versions
can still read the projected assignments as ordinary Parts; rollback does not restore subdivisions.
