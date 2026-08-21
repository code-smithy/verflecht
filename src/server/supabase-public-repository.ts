import type {
  AccessStatus,
  ConnectionClass,
  EntityType,
  ExtractionStatus,
  RelationPredicate,
  SourceQualityClass,
  SourceType,
  VerificationStatus,
} from "@/domain/ontology";
import { InMemoryResearchRepository } from "@/domain/repository";
import type {
  ClaimEvidenceRecord,
  ClaimRecord,
  DocumentRecord,
  EntityAliasRecord,
  EntityRecord,
  JsonRecord,
  SourceRecord,
} from "@/domain/records";
import { createServiceRoleSupabaseClient } from "@/server/supabase-server";

type SupabaseRow = Record<string, unknown>;

type SupabaseTable =
  "sources" | "entities" | "entity_aliases" | "documents" | "claims" | "claim_evidence";

export async function loadPublicResearchRepository(): Promise<InMemoryResearchRepository> {
  const supabase = createServiceRoleSupabaseClient();
  const repository = new InMemoryResearchRepository();
  const [sources, entities, aliases, documents, claims, evidence] = await Promise.all([
    selectRows(supabase, "sources"),
    selectRows(supabase, "entities"),
    selectRows(supabase, "entity_aliases"),
    selectRows(supabase, "documents"),
    selectRows(supabase, "claims"),
    selectRows(supabase, "claim_evidence"),
  ]);

  for (const source of sources) {
    repository.createSource(mapSource(source));
  }

  for (const entity of entities) {
    repository.createEntity(mapEntity(entity));
  }

  for (const alias of aliases) {
    const record = mapEntityAlias(alias);

    if (repository.getEntity(record.entityId)) {
      repository.createEntityAlias(record);
    }
  }

  for (const document of documents) {
    const record = mapDocument(document);

    if (repository.getSource(record.sourceId)) {
      repository.createDocument(record);
    }
  }

  for (const claim of claims) {
    const record = mapClaim(claim);

    if (
      repository.getEntity(record.subjectEntityId) &&
      (!record.objectEntityId || repository.getEntity(record.objectEntityId))
    ) {
      repository.createClaim(record);
    }
  }

  for (const claimEvidence of evidence) {
    const record = mapClaimEvidence(claimEvidence);

    if (repository.getClaim(record.claimId) && repository.getDocument(record.documentId)) {
      repository.createClaimEvidence(record);
    }
  }

  return repository;
}

async function selectRows(
  supabase: ReturnType<typeof createServiceRoleSupabaseClient>,
  table: SupabaseTable,
): Promise<SupabaseRow[]> {
  const { data, error } = await supabase.from(table).select("*");

  if (error) {
    throw new Error(`Failed to load ${table}: ${error.message}`);
  }

  return (data ?? []) as SupabaseRow[];
}

function mapSource(row: SupabaseRow): SourceRecord {
  return {
    id: requiredString(row, "id"),
    name: requiredString(row, "name"),
    domain: optionalString(row, "domain"),
    sourceType: requiredString(row, "source_type") as SourceType,
    sourceQuality: requiredString(row, "source_quality") as SourceQualityClass,
    enabled: requiredBoolean(row, "enabled"),
    metadata: optionalJsonRecord(row, "metadata"),
    createdAt: requiredDate(row, "created_at"),
    updatedAt: requiredDate(row, "updated_at"),
  };
}

function mapEntity(row: SupabaseRow): EntityRecord {
  return {
    id: requiredString(row, "id"),
    entityType: requiredString(row, "entity_type") as EntityType,
    canonicalName: requiredString(row, "canonical_name"),
    slug: requiredString(row, "slug"),
    description: optionalString(row, "description"),
    countryCode: optionalString(row, "country_code"),
    metadata: optionalJsonRecord(row, "metadata"),
    createdAt: requiredDate(row, "created_at"),
    updatedAt: requiredDate(row, "updated_at"),
  };
}

function mapEntityAlias(row: SupabaseRow): EntityAliasRecord {
  return {
    id: requiredString(row, "id"),
    entityId: requiredString(row, "entity_id"),
    alias: requiredString(row, "alias"),
    language: optionalString(row, "language"),
    validFrom: optionalString(row, "valid_from"),
    validTo: optionalString(row, "valid_to"),
    sourceId: optionalString(row, "source_id"),
    createdAt: requiredDate(row, "created_at"),
  };
}

function mapDocument(row: SupabaseRow): DocumentRecord {
  return {
    id: requiredString(row, "id"),
    sourceId: requiredString(row, "source_id"),
    originalUrl: requiredString(row, "original_url"),
    canonicalUrl: optionalString(row, "canonical_url"),
    title: optionalString(row, "title"),
    author: optionalString(row, "author"),
    publisher: optionalString(row, "publisher"),
    publishedAt: optionalDate(row, "published_at"),
    retrievedAt: requiredDate(row, "retrieved_at"),
    contentType: optionalString(row, "content_type"),
    language: optionalString(row, "language"),
    rawStoragePath: optionalString(row, "raw_storage_path"),
    extractedText: optionalString(row, "extracted_text"),
    contentHash: optionalString(row, "content_hash"),
    httpStatus: optionalNumber(row, "http_status"),
    accessStatus: requiredString(row, "access_status") as AccessStatus,
    extractionStatus: requiredString(row, "extraction_status") as ExtractionStatus,
    metadata: optionalJsonRecord(row, "metadata"),
    createdAt: requiredDate(row, "created_at"),
    updatedAt: requiredDate(row, "updated_at"),
  };
}

function mapClaim(row: SupabaseRow): ClaimRecord {
  return {
    id: requiredString(row, "id"),
    subjectEntityId: requiredString(row, "subject_entity_id"),
    predicate: requiredString(row, "predicate") as RelationPredicate,
    objectEntityId: optionalString(row, "object_entity_id"),
    literalValue: optionalJsonRecord(row, "literal_value"),
    connectionClass: requiredString(row, "connection_class") as ConnectionClass,
    validFrom: optionalString(row, "valid_from"),
    validTo: optionalString(row, "valid_to"),
    confidenceScore: optionalNumber(row, "confidence_score"),
    evidenceScore: optionalNumber(row, "evidence_score"),
    validationNotes: optionalJsonRecord(row, "validation_notes"),
    verificationStatus: requiredString(row, "verification_status") as VerificationStatus,
    createdBy: requiredString(row, "created_by"),
    reviewedBy: optionalString(row, "reviewed_by"),
    reviewedAt: optionalDate(row, "reviewed_at"),
    supersedesClaimId: optionalString(row, "supersedes_claim_id"),
    createdAt: requiredDate(row, "created_at"),
    updatedAt: requiredDate(row, "updated_at"),
  };
}

function mapClaimEvidence(row: SupabaseRow): ClaimEvidenceRecord {
  return {
    id: requiredString(row, "id"),
    claimId: requiredString(row, "claim_id"),
    documentId: requiredString(row, "document_id"),
    evidenceText: requiredString(row, "evidence_text"),
    contextBefore: optionalString(row, "context_before"),
    contextAfter: optionalString(row, "context_after"),
    startChar: optionalNumber(row, "start_char"),
    endChar: optionalNumber(row, "end_char"),
    pageNumber: optionalNumber(row, "page_number"),
    section: optionalString(row, "section"),
    evidenceHash: requiredString(row, "evidence_hash"),
    createdAt: requiredDate(row, "created_at"),
  };
}

function requiredString(row: SupabaseRow, key: string): string {
  const value = row[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected ${key} to be a non-empty string.`);
  }

  return value;
}

function optionalString(row: SupabaseRow, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function requiredBoolean(row: SupabaseRow, key: string): boolean {
  const value = row[key];

  if (typeof value !== "boolean") {
    throw new Error(`Expected ${key} to be a boolean.`);
  }

  return value;
}

function optionalNumber(row: SupabaseRow, key: string): number | undefined {
  const value = row[key];
  return typeof value === "number" ? value : undefined;
}

function requiredDate(row: SupabaseRow, key: string): Date {
  const value = optionalDate(row, key);

  if (!value) {
    throw new Error(`Expected ${key} to be a valid date.`);
  }

  return value;
}

function optionalDate(row: SupabaseRow, key: string): Date | undefined {
  const value = row[key];

  if (typeof value !== "string") {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function optionalJsonRecord(row: SupabaseRow, key: string): JsonRecord {
  const value = row[key];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as JsonRecord;
}
