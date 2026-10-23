import { describe, expect, it } from "vitest";
import {
  MAX_PUBLIC_DOCUMENT_BYTES,
  MAX_PUBLIC_DOCUMENTS_PER_ORGANIZATION,
  PUBLIC_DOCUMENT_CONTENT_TYPES,
  parsePublicDocumentIdentifier,
  publicDocumentExtension,
  publicDocumentPath,
  publicDocumentSlugBase,
} from "./publicDocuments";

describe("publicDocuments domain helpers", () => {
  it("defines limits and allowed types", () => {
    expect(MAX_PUBLIC_DOCUMENT_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_PUBLIC_DOCUMENTS_PER_ORGANIZATION).toBe(50);
    expect(PUBLIC_DOCUMENT_CONTENT_TYPES).toEqual([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);
  });

  describe("publicDocumentSlugBase", () => {
    it("normalizes titles to lowercase hyphenated slugs", () => {
      expect(publicDocumentSlugBase("2026-2027 Mail-in Donation Form")).toBe(
        "2026-2027-mail-in-donation-form",
      );
      expect(publicDocumentSlugBase("  Sponsorship   Packet & Guidelines!  ")).toBe(
        "sponsorship-packet-guidelines",
      );
      expect(publicDocumentSlugBase("Événement de Printemps")).toBe("evenement-de-printemps");
    });

    it("falls back to 'document' when title contains no slug characters", () => {
      expect(publicDocumentSlugBase("   ")).toBe("document");
      expect(publicDocumentSlugBase("!!!???###")).toBe("document");
    });

    it("prefixes bare hex/hyphen strings to prevent UUID pattern collisions", () => {
      expect(publicDocumentSlugBase("deadbeef-cafe-0123")).toBe("doc-deadbeef-cafe-0123");
      expect(publicDocumentSlugBase("12345678-1234-1234-1234-123456789abc")).toBe(
        "doc-12345678-1234-1234-1234-123456789abc",
      );
    });

    it("limits length to 80 chars and trims trailing hyphens", () => {
      const longTitle = "A".repeat(100);
      const slug = publicDocumentSlugBase(longTitle);
      expect(slug.length).toBeLessThanOrEqual(80);
      expect(slug.endsWith("-")).toBe(false);
    });
  });

  describe("publicDocumentExtension and publicDocumentPath", () => {
    it("maps content types to extensions", () => {
      expect(publicDocumentExtension("application/pdf")).toBe("pdf");
      expect(
        publicDocumentExtension(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
      ).toBe("docx");
    });

    it("builds the root-relative public download path", () => {
      expect(
        publicDocumentPath({
          contentType: "application/pdf",
          slug: "donation-form",
        }),
      ).toBe("/api/public/documents/donation-form.pdf");

      expect(
        publicDocumentPath({
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          slug: "volunteer-agreement",
        }),
      ).toBe("/api/public/documents/volunteer-agreement.docx");
    });
  });

  describe("parsePublicDocumentIdentifier", () => {
    it("parses valid UUIDs with and without extension", () => {
      const uuid = "e58ed763-928c-4155-bee9-fdbaaadc15f3";
      expect(parsePublicDocumentIdentifier(uuid)).toEqual({
        kind: "id",
        value: uuid,
      });
      expect(parsePublicDocumentIdentifier(`${uuid}.pdf`)).toEqual({
        kind: "id",
        value: uuid,
      });
      expect(parsePublicDocumentIdentifier(`${uuid}.docx`)).toEqual({
        kind: "id",
        value: uuid,
      });
      expect(parsePublicDocumentIdentifier(uuid.toUpperCase())).toEqual({
        kind: "id",
        value: uuid,
      });
    });

    it("parses valid slugs with and without extension", () => {
      expect(parsePublicDocumentIdentifier("mail-in-form")).toEqual({
        kind: "slug",
        value: "mail-in-form",
      });
      expect(parsePublicDocumentIdentifier("mail-in-form.pdf")).toEqual({
        kind: "slug",
        value: "mail-in-form",
      });
      expect(parsePublicDocumentIdentifier("mail-in-form.docx")).toEqual({
        kind: "slug",
        value: "mail-in-form",
      });
      expect(parsePublicDocumentIdentifier("form-2026.PDF")).toEqual({
        kind: "slug",
        value: "form-2026",
      });
    });

    it("rejects invalid identifiers", () => {
      expect(parsePublicDocumentIdentifier("")).toBeNull();
      expect(parsePublicDocumentIdentifier(".pdf")).toBeNull();
      expect(parsePublicDocumentIdentifier("invalid_slug")).toBeNull();
      expect(parsePublicDocumentIdentifier("invalid--slug")).toBeNull();
      expect(parsePublicDocumentIdentifier("-invalid")).toBeNull();
      expect(parsePublicDocumentIdentifier("invalid-")).toBeNull();
      expect(parsePublicDocumentIdentifier("has spaces")).toBeNull();
    });
  });
});
