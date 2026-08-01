import { privateFileResponseSchema, type PrivateFileResponse } from "@choir/contracts";

import { request } from "./client";

export async function uploadPrivateOrganizationFile(
  file: File,
  fileName = file.name,
): Promise<PrivateFileResponse> {
  const fileId = crypto.randomUUID();
  const response = await request(`/api/organization/files/${fileId}`, {
    body: file,
    headers: {
      "content-type": file.type,
      "x-file-name": encodeURIComponent(fileName),
    },
    method: "PUT",
  });
  return privateFileResponseSchema.parse(await response.json());
}

export async function deletePrivateOrganizationFile(fileId: string): Promise<void> {
  await request(`/api/organization/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
}
