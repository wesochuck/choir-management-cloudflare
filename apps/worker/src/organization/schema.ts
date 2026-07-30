import { defaultRosterConfiguration, defaultSeatingConfiguration } from "@choir/domain";

import { ticketMessageTemplates } from "./ticketMessageTemplates";

export interface OrganizationSchemaMigration {
  readonly apply?: (sql: SqlStorage) => void;
  readonly statements: readonly string[];
  readonly version: number;
}

/**
 * These are the legacy system templates whose placeholders are supported by the
 * current Communication Center renderer. Templates that need ticket or donation
 * fields, auditions, or attendance-report data remain listed in
 * docs/communications-system-template-parity.md until those delivery paths expose
 * the corresponding context.
 */
const supportedSystemCommunicationTemplates = [
  {
    channel: "Email",
    contentMarkdown:
      "Hello everyone,\n\nI have an important announcement regarding our upcoming schedule.\n\n[Your message here]\n\nBest regards,\nChoir Management",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000001",
    subject: "Choir Announcement",
    title: "General Announcement",
  },
  {
    channel: "Email",
    contentMarkdown:
      "Hello {singerName},\n\nOur seasonal dues for the current term are now being collected. If you haven't had a chance to pay yet, please do so at your earliest convenience.\n\nIf you've already paid, please ignore this message.\n\nThank you for your support!",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000002",
    subject: "Choir Dues Payment Reminder",
    title: "Dues Payment Notice",
  },
  {
    channel: "Both",
    contentMarkdown:
      "Attention Choir Members,\n\nDue to inclement weather, today's rehearsal/performance for {eventTitle} has been delayed or cancelled.\n\nNew Time/Status: [Details here]\n\nPlease stay safe!",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000003",
    subject: "IMPORTANT: Schedule Change for {eventTitle}",
    title: "Weather / Schedule Delay Alert",
  },
] as const;

function seedSupportedSystemCommunicationTemplates(sql: SqlStorage): void {
  const now = new Date().toISOString();
  for (const template of supportedSystemCommunicationTemplates) {
    sql.exec(
      `INSERT INTO communication_templates
        (id, title, channel, subject, content_markdown, is_system, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, 1, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE id = ?)`,
      template.id,
      template.title,
      template.channel,
      template.subject,
      template.contentMarkdown,
      now,
      now,
      template.id,
    );
  }
}

const rsvpSystemCommunicationTemplates = [
  {
    channel: "Email",
    contentMarkdown:
      "Hello {singerName},\n\nRSVP is now open for our upcoming {eventType}: {eventTitle}.\n\nDate: {eventDate}\nLocation: {eventLocation}\n\nPlease let us know if you can attend using the link below:\n\n{{RSVP_LINKS}}\n\nDetails:\n{eventDetails}",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000004",
    subject: "Invitation: {eventTitle}",
    title: "Event RSVP Invitation",
  },
  {
    channel: "Email",
    contentMarkdown:
      "Hi {singerName},\n\nThis is a friendly reminder for our upcoming rehearsal: {eventTitle}.\n\nDate & Time: {eventDate}\nLocation: {eventLocation}\n\nPlease let us know if you will be attending.\n\nRSVP:\n{{RSVP_LINKS}}\n\nThank you,\nChoir Management",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000005",
    subject: "Reminder: Rehearsal for {eventTitle}",
    title: "Rehearsal Reminder",
  },
] as const;

function seedRsvpSystemCommunicationTemplates(sql: SqlStorage): void {
  const now = new Date().toISOString();
  for (const template of rsvpSystemCommunicationTemplates) {
    sql.exec(
      `INSERT INTO communication_templates
        (id, title, channel, subject, content_markdown, is_system, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, 1, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE id = ?)`,
      template.id,
      template.title,
      template.channel,
      template.subject,
      template.contentMarkdown,
      now,
      now,
      template.id,
    );
  }
}

const playerSystemCommunicationTemplates = [
  {
    channel: "Email",
    contentMarkdown:
      "Hi {singerName},\n\nThis is a friendly reminder for our upcoming performance: {eventTitle}.\n\nDate & Time: {eventDate}\nLocation: {eventLocation}\nCall Time: {eventCallTime}\n\nSet List:\n{setlist}\n\nPractice Player:\n{{PLAYER_LINK}}\n\nRSVP:\n{{RSVP_LINKS}}\n\nThank you,\nChoir Management",
    id: "5f0ca4a5-7e4c-4e1a-9a1c-000000000006",
    subject: "Reminder: Upcoming Performance - {eventTitle}",
    title: "Performance Reminder",
  },
] as const;

function seedPlayerSystemCommunicationTemplates(sql: SqlStorage): void {
  const now = new Date().toISOString();
  for (const template of playerSystemCommunicationTemplates) {
    sql.exec(
      `INSERT INTO communication_templates
        (id, title, channel, subject, content_markdown, is_system, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, 1, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE id = ?)`,
      template.id,
      template.title,
      template.channel,
      template.subject,
      template.contentMarkdown,
      now,
      now,
      template.id,
    );
  }
}

function seedTicketSystemCommunicationTemplates(sql: SqlStorage): void {
  const now = new Date().toISOString();
  for (const template of ticketMessageTemplates) {
    sql.exec(
      `INSERT INTO communication_templates
        (id, title, channel, subject, content_markdown, is_system, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, 1, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE id = ?)`,
      template.id,
      template.title,
      template.channel,
      template.subject,
      template.contentMarkdown,
      now,
      now,
      template.id,
    );
  }
}

export const organizationSchemaMigrations: readonly OrganizationSchemaMigration[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS organization_metadata (
        organization_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        lifecycle_state TEXT NOT NULL DEFAULT 'provisioning',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        actor_type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        change_summary TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS job_ledger (
        idempotency_key TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('claimed', 'completed', 'failed')),
        attempt INTEGER NOT NULL,
        claimed_at TEXT NOT NULL,
        completed_at TEXT
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS scheduler_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        next_due_at TEXT,
        updated_at TEXT NOT NULL
      ) STRICT`,
    ],
  },
  {
    version: 2,
    statements: [
      `CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
    ],
  },
  {
    version: 3,
    statements: ["ALTER TABLE job_ledger ADD COLUMN failed_at TEXT"],
  },
  {
    version: 4,
    statements: [
      `CREATE TABLE IF NOT EXISTS private_files (
        id TEXT PRIMARY KEY,
        storage_key TEXT NOT NULL UNIQUE,
        file_name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'ready')),
        uploaded_by TEXT NOT NULL,
        request_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        ready_at TEXT
      ) STRICT`,
    ],
  },
  {
    version: 5,
    statements: [
      `CREATE TABLE IF NOT EXISTS scheduled_job_outbox (
        job_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        due_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        enqueued_at TEXT
      ) STRICT`,
      `CREATE INDEX IF NOT EXISTS idx_scheduled_job_outbox_pending
       ON scheduled_job_outbox(enqueued_at, due_at)`,
    ],
  },
  {
    version: 6,
    statements: [
      "ALTER TABLE profiles ADD COLUMN calendar_feed_version INTEGER NOT NULL DEFAULT 1",
    ],
  },
  {
    version: 7,
    statements: [
      "ALTER TABLE organization_metadata ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC'",
      `CREATE TABLE IF NOT EXISTS venues (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        address TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('Performance', 'Rehearsal')),
        starts_at TEXT NOT NULL,
        duration_minutes INTEGER,
        call_time TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        venue_id TEXT,
        parent_performance_id TEXT,
        details TEXT NOT NULL DEFAULT '',
        set_list_json TEXT NOT NULL DEFAULT '[]',
        set_list_approved INTEGER NOT NULL DEFAULT 0 CHECK (set_list_approved IN (0, 1)),
        is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE INDEX IF NOT EXISTS idx_events_calendar
       ON events(is_archived, starts_at)`,
      `CREATE TABLE IF NOT EXISTS event_rosters (
        event_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        rsvp TEXT NOT NULL DEFAULT 'Pending' CHECK (rsvp IN ('Yes', 'No', 'Pending')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (event_id, profile_id)
      ) STRICT`,
      `CREATE INDEX IF NOT EXISTS idx_event_rosters_profile
       ON event_rosters(profile_id, event_id)`,
    ],
  },
  {
    version: 8,
    statements: [
      `ALTER TABLE event_rosters ADD COLUMN attendance TEXT NOT NULL DEFAULT 'Pending'
       CHECK (attendance IN ('Present', 'Absent', 'Pending'))`,
    ],
  },
  {
    version: 9,
    statements: [
      "ALTER TABLE profiles ADD COLUMN phone TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE profiles ADD COLUMN voice_part TEXT NOT NULL DEFAULT ''",
      `ALTER TABLE profiles ADD COLUMN global_status TEXT NOT NULL DEFAULT 'Active'
       CHECK (global_status IN ('Active', 'Idle', 'Inactive'))`,
      "ALTER TABLE profiles ADD COLUMN notes TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE profiles ADD COLUMN show_in_directory INTEGER NOT NULL DEFAULT 1 CHECK (show_in_directory IN (0, 1))",
      "ALTER TABLE profiles ADD COLUMN do_not_email INTEGER NOT NULL DEFAULT 0 CHECK (do_not_email IN (0, 1))",
      "ALTER TABLE profiles ADD COLUMN receive_attendance_reports INTEGER NOT NULL DEFAULT 1 CHECK (receive_attendance_reports IN (0, 1))",
      "ALTER TABLE profiles ADD COLUMN receive_rsvp_decline_notices INTEGER NOT NULL DEFAULT 0 CHECK (receive_rsvp_decline_notices IN (0, 1))",
      "ALTER TABLE profiles ADD COLUMN receive_admin_notifications INTEGER NOT NULL DEFAULT 1 CHECK (receive_admin_notifications IN (0, 1))",
      "ALTER TABLE profiles ADD COLUMN receive_financial_alerts INTEGER NOT NULL DEFAULT 0 CHECK (receive_financial_alerts IN (0, 1))",
      "ALTER TABLE profiles ADD COLUMN is_section_leader INTEGER NOT NULL DEFAULT 0 CHECK (is_section_leader IN (0, 1))",
    ],
  },
  {
    version: 10,
    statements: [
      "ALTER TABLE event_rosters ADD COLUMN folder_number TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE event_rosters ADD COLUMN folder_returned INTEGER NOT NULL DEFAULT 0 CHECK (folder_returned IN (0, 1))",
    ],
  },
  {
    version: 11,
    statements: ["ALTER TABLE event_rosters ADD COLUMN rsvp_note TEXT NOT NULL DEFAULT ''"],
  },
  {
    version: 12,
    statements: [
      `ALTER TABLE organization_metadata ADD COLUMN roster_configuration_json TEXT NOT NULL
       DEFAULT '${JSON.stringify(defaultRosterConfiguration)}'`,
    ],
  },
  {
    version: 13,
    statements: [
      `ALTER TABLE organization_metadata ADD COLUMN seating_configuration_json TEXT NOT NULL
       DEFAULT '${JSON.stringify(defaultSeatingConfiguration)}'`,
      `CREATE TABLE seating_charts (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        venue_id TEXT,
        name TEXT NOT NULL,
        formation_id TEXT NOT NULL,
        row_counts_json TEXT NOT NULL,
        section_suggestions_json TEXT NOT NULL DEFAULT '{}',
        assignments_json TEXT NOT NULL DEFAULT '{}',
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE INDEX idx_seating_charts_event_order
       ON seating_charts(event_id, sort_order, name, id)`,
    ],
  },
  {
    version: 14,
    statements: [
      `CREATE TABLE music_pieces (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        composer TEXT NOT NULL DEFAULT '',
        arranger TEXT NOT NULL DEFAULT '',
        purchase_date TEXT,
        copies INTEGER CHECK (copies IS NULL OR copies >= 0),
        catalog_id TEXT NOT NULL DEFAULT '',
        duration_seconds INTEGER CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
        notes TEXT NOT NULL DEFAULT '',
        section_buckets_json TEXT NOT NULL DEFAULT '[]',
        genres_json TEXT NOT NULL DEFAULT '[]',
        parent_id TEXT,
        track_file_ids_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE INDEX idx_music_pieces_title
       ON music_pieces(title COLLATE NOCASE, id)`,
      `CREATE INDEX idx_music_pieces_parent
       ON music_pieces(parent_id, created_at, id)`,
    ],
  },
  {
    version: 15,
    statements: [
      `CREATE TABLE organization_resources (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        file_id TEXT,
        url TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK ((file_id IS NULL) <> (url IS NULL))
      ) STRICT`,
      `CREATE INDEX idx_organization_resources_order
       ON organization_resources(sort_order, title COLLATE NOCASE, id)`,
    ],
  },
  {
    version: 16,
    statements: ["ALTER TABLE profiles ADD COLUMN photo_file_id TEXT"],
  },
  {
    version: 17,
    statements: [
      `CREATE TABLE communication_messages (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL CHECK (channel IN ('Email', 'SMS', 'Both')),
        status TEXT NOT NULL CHECK (status IN ('Draft', 'Queued', 'Sent', 'Failed')),
        subject TEXT NOT NULL DEFAULT '',
        content_markdown TEXT NOT NULL DEFAULT '',
        audience_json TEXT NOT NULL,
        reach_json TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        queued_at TEXT,
        sent_at TEXT
      ) STRICT`,
      `CREATE INDEX idx_communication_messages_history
       ON communication_messages(created_at DESC, id DESC)`,
      `CREATE TABLE communication_deliveries (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        recipient_name TEXT NOT NULL,
        channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
        destination TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'sent', 'failed', 'suppressed')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        provider_message_id TEXT,
        failure_detail TEXT NOT NULL DEFAULT '',
        last_attempt_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (message_id, profile_id, channel)
      ) STRICT`,
      `CREATE INDEX idx_communication_deliveries_message
       ON communication_deliveries(message_id, status, channel, id)`,
      `CREATE TABLE communication_templates (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        channel TEXT NOT NULL CHECK (channel IN ('Email', 'SMS', 'Both')),
        subject TEXT NOT NULL DEFAULT '',
        content_markdown TEXT NOT NULL DEFAULT '',
        is_system INTEGER NOT NULL DEFAULT 0 CHECK (is_system IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE INDEX idx_communication_templates_title
       ON communication_templates(title COLLATE NOCASE, id)`,
    ],
  },
  {
    version: 18,
    statements: [
      "ALTER TABLE communication_deliveries ADD COLUMN unsubscribe_url TEXT",
      `CREATE TABLE communication_suppressions (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL,
        channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
        reason TEXT NOT NULL CHECK (reason IN ('user_unsubscribe', 'manager', 'provider')),
        source_message_id TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (profile_id, channel)
      ) STRICT`,
      `CREATE INDEX idx_communication_suppressions_active
       ON communication_suppressions(channel, active, profile_id)`,
    ],
  },
  {
    version: 19,
    statements: [
      `CREATE TABLE public_website_settings (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        hero_headline TEXT NOT NULL DEFAULT 'Welcome to Our Choir',
        hero_subtitle TEXT NOT NULL DEFAULT 'Voices united in harmony.',
        about_us_text TEXT NOT NULL DEFAULT '',
        history_text TEXT NOT NULL DEFAULT '',
        contact_email TEXT NOT NULL DEFAULT '',
        show_branding_header_footer INTEGER NOT NULL DEFAULT 0 CHECK (show_branding_header_footer IN (0, 1)),
        header_font TEXT NOT NULL DEFAULT 'system',
        body_font TEXT NOT NULL DEFAULT 'system',
        hero_file_id TEXT,
        logo_file_id TEXT,
        enabled_navigation_json TEXT NOT NULL DEFAULT '[]',
        publication_version INTEGER NOT NULL DEFAULT 0 CHECK (publication_version >= 0),
        pending_publication_version INTEGER,
        published_at TEXT,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `INSERT INTO public_website_settings (singleton, updated_at)
       VALUES (1, '1970-01-01T00:00:00.000Z')`,
      "ALTER TABLE events ADD COLUMN public_details TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE events ADD COLUMN public_graphic_file_id TEXT",
      "ALTER TABLE events ADD COLUMN publish_on_website INTEGER NOT NULL DEFAULT 0 CHECK (publish_on_website IN (0, 1))",
      `CREATE INDEX idx_events_public_website
       ON events(publish_on_website, is_archived, type, starts_at DESC, id DESC)`,
    ],
  },
  {
    version: 20,
    statements: [
      "ALTER TABLE events ADD COLUMN is_ticketing_enabled INTEGER NOT NULL DEFAULT 0 CHECK (is_ticketing_enabled IN (0, 1))",
      "ALTER TABLE events ADD COLUMN advance_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (advance_price_cents >= 0)",
      "ALTER TABLE events ADD COLUMN day_of_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (day_of_price_cents >= 0)",
      "ALTER TABLE events ADD COLUMN ticket_capacity INTEGER CHECK (ticket_capacity IS NULL OR ticket_capacity > 0)",
      "ALTER TABLE events ADD COLUMN doors_open_time TEXT NOT NULL DEFAULT ''",
      `CREATE TABLE ticket_purchases (
        id TEXT PRIMARY KEY,
        checkout_request_id TEXT NOT NULL UNIQUE,
        event_id TEXT NOT NULL,
        event_title TEXT NOT NULL,
        event_starts_at TEXT NOT NULL,
        event_timezone TEXT NOT NULL,
        buyer_name TEXT NOT NULL,
        buyer_email TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
        unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
        fee_cents INTEGER NOT NULL CHECK (fee_cents >= 0),
        amount_paid_cents INTEGER NOT NULL CHECK (amount_paid_cents >= 0),
        currency TEXT NOT NULL DEFAULT 'usd' CHECK (currency = 'usd'),
        provider_session_id TEXT NOT NULL UNIQUE,
        provider_payment_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'refunded', 'expired')),
        marketing_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (marketing_opt_in IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        fulfilled_at TEXT,
        expired_at TEXT,
        refunded_at TEXT
      ) STRICT`,
      `CREATE INDEX idx_ticket_purchases_event_status
       ON ticket_purchases(event_id, status, created_at, id)`,
      `CREATE INDEX idx_ticket_purchases_history
       ON ticket_purchases(created_at DESC, id DESC)`,
    ],
  },
  {
    version: 21,
    statements: [
      `CREATE TABLE ticket_scan_events (
        id TEXT PRIMARY KEY,
        purchase_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        actor_user_id TEXT NOT NULL,
        result TEXT NOT NULL CHECK (result IN ('valid', 'not_found', 'not_paid', 'wrong_event')),
        request_id TEXT NOT NULL UNIQUE,
        occurred_at TEXT NOT NULL
      ) STRICT`,
      `CREATE INDEX idx_ticket_scan_events_event
       ON ticket_scan_events(event_id, occurred_at DESC, id DESC)`,
    ],
  },
  {
    version: 22,
    statements: [
      `CREATE TABLE ticket_bundles (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
        capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),
        sale_end_at TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE ticket_bundle_events (
        bundle_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
        PRIMARY KEY (bundle_id, event_id)
      ) STRICT`,
      `CREATE INDEX idx_ticket_bundle_events_event
       ON ticket_bundle_events(event_id, bundle_id)`,
      "ALTER TABLE ticket_purchases ADD COLUMN bundle_id TEXT",
      "ALTER TABLE ticket_purchases ADD COLUMN bundle_title TEXT NOT NULL DEFAULT ''",
      "ALTER TABLE ticket_purchases ADD COLUMN included_events_json TEXT NOT NULL DEFAULT '[]'",
      `CREATE INDEX idx_ticket_purchases_bundle_status
       ON ticket_purchases(bundle_id, status, created_at, id)`,
      `CREATE TABLE ticket_bundle_allocations (
        purchase_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
        PRIMARY KEY (purchase_id, event_id)
      ) STRICT`,
      `CREATE INDEX idx_ticket_bundle_allocations_event
       ON ticket_bundle_allocations(event_id, purchase_id)`,
    ],
  },
  {
    version: 23,
    statements: [
      `CREATE TABLE ticket_notifications (
        id TEXT PRIMARY KEY,
        purchase_id TEXT NOT NULL,
        event_id TEXT,
        dedupe_key TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK (kind IN ('confirmation', 'reminder')),
        destination TEXT NOT NULL,
        subject TEXT NOT NULL,
        content_markdown TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'sent', 'failed', 'suppressed')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        provider_message_id TEXT,
        failure_detail TEXT NOT NULL DEFAULT '',
        scheduled_for TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sent_at TEXT
      ) STRICT`,
      `CREATE INDEX idx_ticket_notifications_status
       ON ticket_notifications(status, scheduled_for, id)`,
      `CREATE INDEX idx_ticket_notifications_purchase
       ON ticket_notifications(purchase_id, kind, event_id)`,
      `UPDATE scheduler_state
       SET next_due_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 hour'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE singleton = 1`,
    ],
  },
  {
    version: 24,
    statements: [`ALTER TABLE events ADD COLUMN reminder_sent_at TEXT`],
  },
  {
    version: 25,
    statements: [
      `CREATE TABLE IF NOT EXISTS polls (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        multiple_choice INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT NOT NULL DEFAULT '',
        archived_at TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS poll_options (
        id TEXT PRIMARY KEY,
        poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        label TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS poll_responses (
        poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
        profile_id TEXT NOT NULL,
        option_ids TEXT NOT NULL,
        profile_name TEXT NOT NULL DEFAULT '',
        responded_at TEXT NOT NULL,
        PRIMARY KEY (poll_id, profile_id)
      ) STRICT`,
      `CREATE INDEX idx_poll_options_poll ON poll_options(poll_id, sort_order, id)`,
      `CREATE INDEX idx_poll_responses_poll ON poll_responses(poll_id, profile_id)`,
    ],
  },
  {
    version: 26,
    statements: [
      `CREATE TABLE IF NOT EXISTS auditions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL DEFAULT '',
        voice_part TEXT NOT NULL DEFAULT '',
        experience TEXT NOT NULL DEFAULT '',
        availability_notes TEXT NOT NULL DEFAULT '',
        admin_notes TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'scheduled', 'completed', 'cancelled', 'no_show')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE TABLE IF NOT EXISTS audition_slots (
        id TEXT PRIMARY KEY,
        audition_id TEXT NOT NULL REFERENCES auditions(id) ON DELETE CASCADE,
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT`,
      `CREATE INDEX idx_audition_slots_audition ON audition_slots(audition_id, starts_at)`,
      `CREATE INDEX idx_auditions_email ON auditions(email)`,
      `CREATE INDEX idx_auditions_status ON auditions(status)`,
    ],
  },
  {
    version: 27,
    statements: [
      `CREATE TABLE IF NOT EXISTS patrons (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        total_donated_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_donated_cents >= 0),
        donation_count INTEGER NOT NULL DEFAULT 0 CHECK (donation_count >= 0),
        first_donated_at TEXT NOT NULL,
        last_donated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_patrons_email ON patrons(email)`,
      `CREATE TABLE IF NOT EXISTS donations (
        id TEXT PRIMARY KEY,
        checkout_request_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'refunded')),
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        tribute_type TEXT NOT NULL DEFAULT 'none' CHECK (tribute_type IN ('honor', 'memory', 'anonymous', 'none')),
        tribute_name TEXT NOT NULL DEFAULT '',
        tribute_notify_email TEXT NOT NULL DEFAULT '',
        anonymous INTEGER NOT NULL DEFAULT 0 CHECK (anonymous IN (0, 1)),
        marketing_consent INTEGER NOT NULL DEFAULT 0 CHECK (marketing_consent IN (0, 1)),
        buyer_name TEXT NOT NULL,
        buyer_email TEXT NOT NULL,
        patron_id TEXT,
        provider_session_id TEXT NOT NULL UNIQUE,
        provider_payment_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        refunded_at TEXT,
        FOREIGN KEY (patron_id) REFERENCES patrons(id)
      ) STRICT`,
      `CREATE INDEX IF NOT EXISTS idx_donations_created ON donations(created_at DESC, id DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_donations_patron ON donations(patron_id, created_at DESC)`,
    ],
  },
  {
    version: 28,
    statements: [
      `CREATE TABLE IF NOT EXISTS seasons (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL,
        dues_amount_cents INTEGER NOT NULL CHECK (dues_amount_cents >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
      `CREATE INDEX IF NOT EXISTS idx_seasons_created ON seasons(created_at DESC, id DESC)`,
      `CREATE TABLE IF NOT EXISTS dues (
        id TEXT PRIMARY KEY,
        season_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
        provider_session_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'refunded')),
        paid_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (season_id) REFERENCES seasons(id),
        UNIQUE (season_id, profile_id)
      ) STRICT`,
      `CREATE INDEX IF NOT EXISTS idx_dues_season ON dues(season_id, created_at DESC, id DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_dues_profile ON dues(profile_id, season_id)`,
    ],
  },
  {
    version: 29,
    statements: [
      `CREATE TABLE IF NOT EXISTS setup_state (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        organization_id TEXT NOT NULL UNIQUE,
        organization_name TEXT NOT NULL DEFAULT '',
        completed_steps TEXT NOT NULL DEFAULT '[]',
        current_step TEXT,
        launched INTEGER NOT NULL DEFAULT 0 CHECK (launched IN (0, 1)),
        module_config TEXT NOT NULL DEFAULT '{}',
        theme_config TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
    ],
  },
  {
    version: 30,
    statements: [
      `ALTER TABLE organization_metadata ADD COLUMN audition_settings_json TEXT NOT NULL
       DEFAULT '{"enabled":true,"defaultPerformanceId":null,"confirmationMessage":"Thank you for your interest. We will be in touch soon.","adminNotifyEnabled":false,"adminNotifyUsers":[],"slots":[]}'`,
      "ALTER TABLE auditions ADD COLUMN performance_id TEXT",
      "ALTER TABLE auditions ADD COLUMN scheduled_time_slot TEXT",
      "ALTER TABLE auditions ADD COLUMN requested_slots_json TEXT NOT NULL DEFAULT '[]'",
      "CREATE INDEX IF NOT EXISTS idx_auditions_performance ON auditions(performance_id, status, created_at)",
    ],
  },
  {
    version: 31,
    statements: [
      `CREATE TABLE audition_notifications (
        id TEXT PRIMARY KEY,
        audition_id TEXT NOT NULL REFERENCES auditions(id) ON DELETE CASCADE,
        dedupe_key TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK (kind IN ('inquiry_confirmation', 'scheduled_confirmation', 'admin_alert')),
        destination TEXT NOT NULL,
        recipient_name TEXT NOT NULL,
        subject TEXT NOT NULL,
        content_markdown TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'sent', 'failed', 'suppressed')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        provider_message_id TEXT,
        failure_detail TEXT NOT NULL DEFAULT '',
        scheduled_for TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        sent_at TEXT
      ) STRICT`,
      `CREATE INDEX idx_audition_notifications_status
       ON audition_notifications(status, scheduled_for, id)`,
      `CREATE INDEX idx_audition_notifications_audition
       ON audition_notifications(audition_id, kind, destination)`,
    ],
  },
  {
    version: 32,
    statements: [
      `CREATE TABLE organization_exports (
        id TEXT PRIMARY KEY,
        format TEXT NOT NULL CHECK (format = 'json'),
        status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
        actor_user_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        archive_key TEXT,
        byte_count INTEGER,
        checksum_sha256 TEXT,
        error_code TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      ) STRICT`,
      `CREATE INDEX idx_organization_exports_status
       ON organization_exports(status, created_at DESC, id DESC)`,
    ],
  },
  {
    version: 33,
    statements: [
      "ALTER TABLE organization_exports ADD COLUMN actor_type TEXT NOT NULL DEFAULT 'organization_member'",
    ],
  },
  {
    version: 34,
    statements: [
      `CREATE TABLE IF NOT EXISTS donation_expirations (
        donation_id TEXT PRIMARY KEY REFERENCES donations(id) ON DELETE CASCADE,
        stripe_event_id TEXT NOT NULL UNIQUE,
        expired_at TEXT NOT NULL
      ) STRICT`,
      `CREATE INDEX IF NOT EXISTS idx_donation_expirations_expired_at
       ON donation_expirations(expired_at, donation_id)`,
    ],
  },
  {
    apply: (sql) => {
      const seasonColumns = new Set(
        [...sql.exec<{ readonly name: string }>("PRAGMA table_info(seasons)")].map(
          ({ name }) => name,
        ),
      );
      if (!seasonColumns.has("is_active")) {
        sql.exec(
          "ALTER TABLE seasons ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1))",
        );
      }

      const duesColumns = new Set(
        [...sql.exec<{ readonly name: string }>("PRAGMA table_info(dues)")].map(({ name }) => name),
      );
      if (!duesColumns.has("provider_session_id")) {
        sql.exec("ALTER TABLE dues ADD COLUMN provider_session_id TEXT NOT NULL DEFAULT ''");
      }
    },
    statements: [],
    version: 35,
  },
  {
    version: 36,
    statements: [
      `ALTER TABLE organization_metadata ADD COLUMN donation_settings_json TEXT NOT NULL
       DEFAULT '{"buttonText":"Support our Music","description":"Your contribution helps us keep the music playing and supports our mission in the community.","levels":[{"id":"level-1","label":"Friend","amountCents":2500,"benefit":"Mention in program"},{"id":"level-2","label":"Supporter","amountCents":5000,"benefit":"Mention in program"},{"id":"level-3","label":"Patron","amountCents":10000,"benefit":"Priority seating"},{"id":"level-4","label":"Benefactor","amountCents":25000,"benefit":"Invitation to VIP reception"}]}'`,
    ],
  },
  {
    version: 37,
    statements: [
      `ALTER TABLE organization_metadata ADD COLUMN transaction_fee_settings_json TEXT NOT NULL
       DEFAULT '{"fixedCents":30,"passFeeToDonor":false,"percentage":2.9}'`,
    ],
  },
  {
    version: 38,
    statements: [
      "ALTER TABLE donations ADD COLUMN fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (fee_cents >= 0)",
      "ALTER TABLE dues ADD COLUMN fee_cents INTEGER NOT NULL DEFAULT 0 CHECK (fee_cents >= 0)",
    ],
  },
  {
    version: 39,
    statements: [
      `ALTER TABLE organization_metadata ADD COLUMN ticket_confirmation_settings_json TEXT NOT NULL
       DEFAULT '{"successMessage":"Your purchase has been successfully processed.","pendingMessage":"We could not load the full ticket details yet. Your purchase may still be processing. Please refresh this page in a moment, or contact the box office if this continues.","willCallInstructions":"A confirmation email has been sent with a link back to this page. Your tickets will be held at Will Call on show day. Please bring a photo ID matching the buyer’s name.","qrCodeInstructions":"Print or screenshot this entire page and bring it with you. We also sent a confirmation email with a link back to this page."}'`,
    ],
  },
  {
    version: 40,
    statements: [
      `CREATE TABLE IF NOT EXISTS stripe_connect_accounts (
        organization_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL UNIQUE,
        details_submitted INTEGER NOT NULL DEFAULT 0 CHECK (details_submitted IN (0, 1)),
        charges_enabled INTEGER NOT NULL DEFAULT 0 CHECK (charges_enabled IN (0, 1)),
        payouts_enabled INTEGER NOT NULL DEFAULT 0 CHECK (payouts_enabled IN (0, 1)),
        requirements_due_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT`,
    ],
  },
  {
    version: 41,
    apply: seedSupportedSystemCommunicationTemplates,
    statements: [],
  },
  {
    version: 42,
    apply: seedRsvpSystemCommunicationTemplates,
    statements: [],
  },
  {
    version: 43,
    apply: seedPlayerSystemCommunicationTemplates,
    statements: [],
  },
  {
    version: 44,
    apply: seedTicketSystemCommunicationTemplates,
    statements: [],
  },
] as const;

export const currentOrganizationSchemaVersion = organizationSchemaMigrations.at(-1)?.version ?? 0;
