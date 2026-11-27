import { privateFileResponseSchema, type PrivateFileResponse } from "@choir/contracts";

import { request } from "./client";

export async function uploadPrivateOrganizationFile(
  file: File,
  fileName = file.name,
  scope?: "website",
): Promise<PrivateFileResponse> {
  const fileId = crypto.randomUUID();
  const contentType = file.type.toLowerCase() === "image/jpg" ? "image/jpeg" : file.type;
  const response = await request(
    `/api/organization/files/${fileId}${scope ? "?scope=website" : ""}`,
    {
      body: file,
      headers: {
        "content-type": contentType,
        "x-file-name": encodeURIComponent(fileName),
      },
      method: "PUT",
    },
  );
  return privateFileResponseSchema.parse(await response.json());
}

export async function deletePrivateOrganizationFile(
  fileId: string,
  scope?: "website",
): Promise<void> {
  await request(
    `/api/organization/files/${encodeURIComponent(fileId)}${scope ? "?scope=website" : ""}`,
    { method: "DELETE" },
  );
}
