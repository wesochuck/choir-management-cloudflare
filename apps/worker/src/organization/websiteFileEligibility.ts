export function isOwnedWebsiteUpload(
  storage: DurableObjectStorage,
  fileId: string,
  actorUserId: string,
): boolean {
  return (
    storage.sql
      .exec(
        `SELECT id FROM private_files WHERE id = ? AND uploaded_by = ?
       AND status = 'ready' AND website_upload = 1 LIMIT 1`,
        fileId,
        actorUserId,
      )
      .toArray().length > 0
  );
}
