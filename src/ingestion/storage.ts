import type { SupabaseClient } from "@supabase/supabase-js";

export type RawDocumentUpload = {
  path: string;
  body: Uint8Array;
  contentType?: string;
  metadata?: Record<string, string>;
};

export type StoredRawDocument = {
  path: string;
};

export type RawDocumentStorage = {
  putRawDocument(upload: RawDocumentUpload): Promise<StoredRawDocument>;
};

function extensionForContentType(contentType?: string): string {
  const normalized = contentType?.split(";")[0]?.trim().toLowerCase();

  switch (normalized) {
    case "application/pdf":
      return "pdf";
    case "application/json":
    case "application/ld+json":
      return "json";
    case "text/plain":
      return "txt";
    case "text/html":
    case "application/xhtml+xml":
    default:
      return "html";
  }
}

function sanitizePathSegment(segment: string): string {
  return segment
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function buildRawDocumentPath(input: {
  sourceType: string;
  sourceId: string;
  canonicalUrl: string;
  contentHash: string;
  contentType?: string;
}): string {
  const host = sanitizePathSegment(new URL(input.canonicalUrl).host);
  const sourceType = sanitizePathSegment(input.sourceType);
  const sourceId = sanitizePathSegment(input.sourceId);
  const extension = extensionForContentType(input.contentType);

  return `raw-documents/${sourceType}/${sourceId}/${host}/${input.contentHash}.${extension}`;
}

export class InMemoryRawDocumentStorage implements RawDocumentStorage {
  private readonly objects = new Map<string, RawDocumentUpload>();

  async putRawDocument(upload: RawDocumentUpload): Promise<StoredRawDocument> {
    this.objects.set(upload.path, {
      ...upload,
      body: new Uint8Array(upload.body),
      metadata: upload.metadata ? { ...upload.metadata } : undefined,
    });
    return { path: upload.path };
  }

  getObject(path: string): RawDocumentUpload | undefined {
    const object = this.objects.get(path);

    if (!object) {
      return undefined;
    }

    return {
      ...object,
      body: new Uint8Array(object.body),
      metadata: object.metadata ? { ...object.metadata } : undefined,
    };
  }
}

export class SupabaseRawDocumentStorage implements RawDocumentStorage {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly bucket = "raw-documents",
  ) {}

  async putRawDocument(upload: RawDocumentUpload): Promise<StoredRawDocument> {
    const pathWithoutBucket = upload.path.startsWith(`${this.bucket}/`)
      ? upload.path.slice(this.bucket.length + 1)
      : upload.path;
    const { error } = await this.supabase.storage
      .from(this.bucket)
      .upload(pathWithoutBucket, upload.body, {
        contentType: upload.contentType,
        metadata: upload.metadata,
        upsert: false,
      });

    if (error) {
      throw new Error(`Supabase Storage upload failed: ${error.message}`);
    }

    return { path: `${this.bucket}/${pathWithoutBucket}` };
  }
}
