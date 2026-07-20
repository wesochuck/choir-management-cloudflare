# Use Organization as the Tenant Boundary

Each Organization is an independently managed tenant with one roster, event calendar, music catalog,
configuration set, file namespace, communications history, and set of commercial records. A person
may use one identity to hold separate memberships and roles in multiple Organizations, but the
product will not introduce a parent Organization containing multiple Ensembles.

**Why:** This preserves the operational model already expressed throughout the product while
allowing one deployment to serve many groups. It trades shared cross-ensemble resources inside an
umbrella customer for a smaller and safer authorization boundary; groups that need independent
administration remain separate Organizations even when the same person helps manage both.
