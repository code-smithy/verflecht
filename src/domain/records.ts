import type {
  AccessStatus,
  ConnectionClass,
  EntityType,
  ExtractionStatus,
  RelationPredicate,
  SourceQualityClass,
  SourceType,
  VerificationStatus,
} from "./ontology";

export type JsonRecord = Record<string, unknown>;

export type EntityRecord = {
  id: string;
  entityType: EntityType;
  canonicalName: string;
  slug: string;
  description?: string;
  countryCode?: string;
  metadata: JsonRecord;
  createdAt: Date;
  updatedAt: Date;
};

export type SourceRecord = {
  id: string;
  name: string;
  domain?: string;
  sourceType: SourceType;
  sourceQuality: SourceQualityClass;
  enabled: boolean;
  metadata: JsonRecord;
  createdAt: Date;
  updatedAt: Date;
};

export type DocumentRecord = {
  id: string;
  sourceId: string;
  originalUrl: string;
  canonicalUrl?: string;
  title?: string;
  author?: string;
  publisher?: string;
  publishedAt?: Date;
  retrievedAt: Date;
  contentType?: string;
  language?: string;
  rawStoragePath?: string;
  extractedText?: string;
  contentHash?: string;
  httpStatus?: number;
  accessStatus: AccessStatus;
  extractionStatus: ExtractionStatus;
  metadata: JsonRecord;
  createdAt: Date;
  updatedAt: Date;
};

export type ClaimRecord = {
  id: string;
  subjectEntityId: string;
  predicate: RelationPredicate;
  objectEntityId?: string;
  literalValue?: JsonRecord;
  connectionClass: ConnectionClass;
  validFrom?: string;
  validTo?: string;
  confidenceScore?: number;
  verificationStatus: VerificationStatus;
  createdBy: string;
  reviewedBy?: string;
  reviewedAt?: Date;
  supersedesClaimId?: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ClaimEvidenceRecord = {
  id: string;
  claimId: string;
  documentId: string;
  evidenceText: string;
  contextBefore?: string;
  contextAfter?: string;
  startChar?: number;
  endChar?: number;
  pageNumber?: number;
  section?: string;
  evidenceHash: string;
  createdAt: Date;
};

export type AuditLogRecord = {
  id: string;
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  previousValue?: JsonRecord;
  newValue?: JsonRecord;
  createdAt: Date;
};

export type EntityDraft = Omit<EntityRecord, "id" | "createdAt" | "updatedAt">;
export type SourceDraft = Omit<SourceRecord, "id" | "createdAt" | "updatedAt">;
export type DocumentDraft = Omit<DocumentRecord, "id" | "createdAt" | "updatedAt" | "retrievedAt"> &
  Partial<Pick<DocumentRecord, "retrievedAt">>;
export type ClaimRecordDraft = Omit<ClaimRecord, "id" | "createdAt" | "updatedAt">;
export type ClaimEvidenceDraft = Omit<ClaimEvidenceRecord, "id" | "createdAt" | "evidenceHash"> &
  Partial<Pick<ClaimEvidenceRecord, "evidenceHash">>;
