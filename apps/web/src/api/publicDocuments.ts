import {
  publicWebsiteDocumentDeleteResponseSchema,
  publicWebsiteDocumentResponseSchema,
  publicWebsiteDocumentsResponseSchema,
  type PublicWebsiteDocument,
  type PublicWebsiteDocumentRequest,
} from "@choir/contracts";

import { request } from "./client";

export async function listOrganizationPublicDocuments(
  signal?: AbortSignal,
): Promise<readonly PublicWebsiteDocument[]> {
  const response = await request("/api/organization/website/documents", {
    signal: signal ?? null,
  });
  return publicWebsiteDocumentsResponseSchema.parse(await response.json()).documents;
}

export async function createOrganizationPublicDocument(
  document: PublicWebsiteDocumentRequest,
): Promise<PublicWebsiteDocument> {
  const response = await request("/api/organization/website/documents", {
    body: JSON.stringify(document),
    method: "POST",
  });
  return publicWebsiteDocumentResponseSchema.parse(await response.json());
}

export async function updateOrganizationPublicDocument(
  documentId: string,
  document: PublicWebsiteDocumentRequest,
): Promise<PublicWebsiteDocument> {
  const response = await request(
    `/api/organization/website/documents/${encodeURIComponent(documentId)}`,
    {
      body: JSON.stringify(document),
      method: "PUT",
    },
  );
  return publicWebsiteDocumentResponseSchema.parse(await response.json());
}

export async function deleteOrganizationPublicDocument(documentId: string): Promise<void> {
  const response = await request(
    `/api/organization/website/documents/${encodeURIComponent(documentId)}`,
    {
      method: "DELETE",
    },
  );
  publicWebsiteDocumentDeleteResponseSchema.parse(await response.json());
}
