# Organization Physical Postal Address for CAN-SPAM and Communications

Organizations maintain a canonical physical postal mailing address or registered PO Box under
Organization identity. The physical address is configured optionally during initial First-Run Setup
and managed in Organization Settings alongside Organization Name, Logo, and Timezone.

All outbound Organization-scoped communications (broadcast messages, event reminders, ticket
receipts, audition notifications, and dues invoices) automatically include the formatted physical
address in both HTML and plain-text email footers alongside the Organization attribution and signed
unsubscribe link to satisfy CAN-SPAM and global postal deliverability requirements.

Platform-level authentication emails (such as 2FA codes and global account password resets) remain
platform-branded and do not include tenant-specific physical addresses.

The physical address is stored in the Organization Durable Object in
`organization_metadata.physical_address` as a freeform multiline string (`max 2,000` characters),
accommodating international postal formats, PO boxes, church offices, and fiscal-sponsor c/o routing
without rigid regional validation constraints.

**Why:** Commercial and bulk email compliance (CAN-SPAM, CASL, GDPR, and mailbox provider
deliverability guidelines from Gmail and Yahoo) mandates a valid physical postal address for the
sender. Modeling the address as an Organization-level identity attribute rather than a siloed email
setting ensures consistent brand identity across all tenant communications, avoids schema
fragmentation, and enables future reuse in official receipts, invoices, and public disclosures.
