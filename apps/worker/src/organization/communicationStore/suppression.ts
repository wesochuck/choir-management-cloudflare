/** Recheck current consent against only this bounded batch or one delivery. */
export function suppressCommunicationBatch(
  storage: DurableObjectStorage,
  messageId: string,
  jobId: string,
  ticketServiceNotice: boolean,
  deliveryId: string | null = null,
): void {
  const now = new Date().toISOString();
  const contactPreferenceSuppression = ticketServiceNotice
    ? `OR EXISTS (
             SELECT 1 FROM contact_communication_preferences pref
             WHERE pref.contact_id = communication_deliveries.profile_id
               AND pref.channel = 'email' AND pref.status = 'unsubscribed'
               AND pref.source IN ('provider_bounce', 'provider_complaint')
           )`
    : `OR EXISTS (
             SELECT 1 FROM contact_communication_preferences pref
             WHERE pref.contact_id = communication_deliveries.profile_id
               AND pref.channel = 'email' AND pref.status = 'unsubscribed'
           )`;
  storage.sql.exec(
    `UPDATE communication_deliveries
       SET status = 'suppressed', failure_detail = '', updated_at = ?
       WHERE message_id = ? AND delivery_job_id = ? AND (? IS NULL OR id = ?) AND channel = 'email' AND status IN ('queued', 'processing')
         AND (
           EXISTS (
             SELECT 1 FROM profiles p
             WHERE p.id IN (
               communication_deliveries.profile_id,
               (
                 SELECT linked_contact.profile_id
                 FROM contacts linked_contact
                 WHERE linked_contact.id = communication_deliveries.profile_id
               )
             )
               AND (
                 p.do_not_email = 1 OR p.provider_email_suppressed = 1
                 OR p.last_bounce_at <> '' OR EXISTS (
                   SELECT 1 FROM communication_suppressions s
                   WHERE s.profile_id = p.id AND s.channel = 'email' AND s.active = 1
                 )
               )
           )
           ${contactPreferenceSuppression}
           OR EXISTS (
             SELECT 1 FROM contacts c
             JOIN contact_communication_preferences pref ON pref.contact_id = c.id
             WHERE c.profile_id = communication_deliveries.profile_id
               AND pref.channel = 'email' AND pref.status = 'unsubscribed'
           )
           OR EXISTS (
             SELECT 1 FROM contacts c
             JOIN communication_suppressions s ON s.profile_id = c.profile_id
             WHERE c.id = communication_deliveries.profile_id
               AND s.channel = 'email' AND s.active = 1
           )
           OR EXISTS (
             SELECT 1 FROM communication_messages m, profiles p
             WHERE m.id = communication_deliveries.message_id
               AND p.id IN (
                 communication_deliveries.profile_id,
                 (
                   SELECT linked_contact.profile_id
                   FROM contacts linked_contact
                   WHERE linked_contact.id = communication_deliveries.profile_id
                 )
               )
               AND (
                 (
                   json_extract(m.automation_json, '$.kind') = 'event_reminder'
                   AND (
                     (
                       json_extract(m.automation_json, '$.eventType') = 'Rehearsal'
                       AND p.receive_rehearsal_reminders = 0
                     )
                     OR (
                       json_extract(m.automation_json, '$.eventType') = 'Performance'
                       AND p.receive_performance_reminders = 0
                     )
                     OR (
                       json_extract(m.automation_json, '$.eventType') NOT IN ('Rehearsal', 'Performance')
                       AND p.receive_other_event_reminders = 0
                     )
                   )
                 )
                 OR (
                   json_extract(m.automation_json, '$.kind') = 'rsvp_follow_up'
                   AND json_extract(m.automation_json, '$.eventType') NOT IN ('Rehearsal', 'Performance')
                   AND p.receive_other_event_reminders = 0
                 )
               )
           )
         )`,
    now,
    messageId,
    jobId,
    deliveryId,
    deliveryId,
  );

  storage.sql.exec(
    `UPDATE communication_deliveries SET status = 'suppressed', failure_detail = '', updated_at = ?
     WHERE message_id = ? AND delivery_job_id = ? AND (? IS NULL OR id = ?)
       AND channel = 'sms' AND status IN ('queued', 'processing') AND (
         EXISTS (SELECT 1 FROM contact_communication_preferences pref
           WHERE pref.contact_id = communication_deliveries.profile_id AND pref.channel = 'sms' AND pref.status = 'unsubscribed')
         OR EXISTS (SELECT 1 FROM communication_suppressions s
           WHERE s.channel = 'sms' AND s.active = 1 AND s.profile_id IN (
             communication_deliveries.profile_id,
             (SELECT profile_id FROM contacts WHERE id = communication_deliveries.profile_id)))
         OR EXISTS (SELECT 1 FROM contacts c JOIN contact_communication_preferences pref ON pref.contact_id = c.id
           WHERE c.profile_id = communication_deliveries.profile_id AND pref.channel = 'sms' AND pref.status = 'unsubscribed')
       )`,
    now,
    messageId,
    jobId,
    deliveryId,
    deliveryId,
  );
}
