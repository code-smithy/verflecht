import type {
  AuditLogRecord,
  ClaimEvidenceRecord,
  ClaimRecord,
  DocumentRecord,
  EntityAliasRecord,
  EntityResolutionCandidateRecord,
  EntityResolutionTaskRecord,
  EntityRecord,
  LlmRunRecord,
  ReviewQueueRecord,
  SourceRecord,
} from "./records";

type StoredRecord = { id: string };

function cloneRecord<T extends StoredRecord>(record: T): T {
  return { ...record };
}

function updateStoredRecord<T extends StoredRecord>(
  map: Map<string, T>,
  id: string,
  changes: Partial<T>,
): T {
  const current = map.get(id);

  if (!current) {
    throw new Error(`Record not found: ${id}`);
  }

  const updated = { ...current, ...changes };
  map.set(id, updated);
  return cloneRecord(updated);
}

export type ResearchRepository = {
  createEntity(record: EntityRecord): EntityRecord;
  getEntity(id: string): EntityRecord | undefined;
  updateEntity(id: string, changes: Partial<EntityRecord>): EntityRecord;
  listEntities(): EntityRecord[];

  createEntityAlias(record: EntityAliasRecord): EntityAliasRecord;
  getEntityAlias(id: string): EntityAliasRecord | undefined;
  listEntityAliases(): EntityAliasRecord[];
  listEntityAliasesByEntityId(entityId: string): EntityAliasRecord[];

  createSource(record: SourceRecord): SourceRecord;
  getSource(id: string): SourceRecord | undefined;
  listSources(): SourceRecord[];

  createDocument(record: DocumentRecord): DocumentRecord;
  getDocument(id: string): DocumentRecord | undefined;
  updateDocument(id: string, changes: Partial<DocumentRecord>): DocumentRecord;
  listDocuments(): DocumentRecord[];

  createClaim(record: ClaimRecord): ClaimRecord;
  getClaim(id: string): ClaimRecord | undefined;
  updateClaim(id: string, changes: Partial<ClaimRecord>): ClaimRecord;
  listClaims(): ClaimRecord[];

  createClaimEvidence(record: ClaimEvidenceRecord): ClaimEvidenceRecord;
  getClaimEvidence(id: string): ClaimEvidenceRecord | undefined;
  listClaimEvidence(): ClaimEvidenceRecord[];
  listClaimEvidenceByClaimId(claimId: string): ClaimEvidenceRecord[];

  createAuditLog(record: AuditLogRecord): AuditLogRecord;
  listAuditLogs(): AuditLogRecord[];

  createReviewQueueItem(record: ReviewQueueRecord): ReviewQueueRecord;
  getReviewQueueItem(id: string): ReviewQueueRecord | undefined;
  updateReviewQueueItem(id: string, changes: Partial<ReviewQueueRecord>): ReviewQueueRecord;
  listReviewQueueItems(): ReviewQueueRecord[];
  listReviewQueueItemsByClaimId(claimId: string): ReviewQueueRecord[];

  createLlmRun(record: LlmRunRecord): LlmRunRecord;
  getLlmRun(id: string): LlmRunRecord | undefined;
  listLlmRuns(): LlmRunRecord[];

  createEntityResolutionTask(record: EntityResolutionTaskRecord): EntityResolutionTaskRecord;
  getEntityResolutionTask(id: string): EntityResolutionTaskRecord | undefined;
  listEntityResolutionTasks(): EntityResolutionTaskRecord[];

  createEntityResolutionCandidate(
    record: EntityResolutionCandidateRecord,
  ): EntityResolutionCandidateRecord;
  listEntityResolutionCandidatesByTaskId(taskId: string): EntityResolutionCandidateRecord[];
};

export class InMemoryResearchRepository implements ResearchRepository {
  private readonly entities = new Map<string, EntityRecord>();
  private readonly entityAliases = new Map<string, EntityAliasRecord>();
  private readonly sources = new Map<string, SourceRecord>();
  private readonly documents = new Map<string, DocumentRecord>();
  private readonly claims = new Map<string, ClaimRecord>();
  private readonly claimEvidence = new Map<string, ClaimEvidenceRecord>();
  private readonly auditLogs = new Map<string, AuditLogRecord>();
  private readonly reviewQueueItems = new Map<string, ReviewQueueRecord>();
  private readonly llmRuns = new Map<string, LlmRunRecord>();
  private readonly entityResolutionTasks = new Map<string, EntityResolutionTaskRecord>();
  private readonly entityResolutionCandidates = new Map<string, EntityResolutionCandidateRecord>();

  createEntity(record: EntityRecord): EntityRecord {
    this.entities.set(record.id, cloneRecord(record));
    return cloneRecord(record);
  }

  getEntity(id: string): EntityRecord | undefined {
    const record = this.entities.get(id);
    return record ? cloneRecord(record) : undefined;
  }

  updateEntity(id: string, changes: Partial<EntityRecord>): EntityRecord {
    return updateStoredRecord(this.entities, id, changes);
  }

  listEntities(): EntityRecord[] {
    return Array.from(this.entities.values(), cloneRecord);
  }

  createEntityAlias(record: EntityAliasRecord): EntityAliasRecord {
    this.entityAliases.set(record.id, cloneRecord(record));
    return cloneRecord(record);
  }

  getEntityAlias(id: string): EntityAliasRecord | undefined {
    const record = this.entityAliases.get(id);
    return record ? cloneRecord(record) : undefined;
  }

  listEntityAliases(): EntityAliasRecord[] {
    return Array.from(this.entityAliases.values(), cloneRecord);
  }

  listEntityAliasesByEntityId(entityId: string): EntityAliasRecord[] {
    return this.listEntityAliases().filter((alias) => alias.entityId === entityId);
  }

  createSource(record: SourceRecord): SourceRecord {
    this.sources.set(record.id, cloneRecord(record));
    return cloneRecord(record);
  }

  getSource(id: string): SourceRecord | undefined {
    const record = this.sources.get(id);
    return record ? cloneRecord(record) : undefined;
  }

  listSources(): SourceRecord[] {
    return Array.from(this.sources.values(), cloneRecord);
  }

  createDocument(record: DocumentRecord): DocumentRecord {
    this.documents.set(record.id, cloneRecord(record));
    return cloneRecord(record);
  }

  getDocument(id: string): DocumentRecord | undefined {
    const record = this.documents.get(id);
    return record ? cloneRecord(record) : undefined;
  }

  updateDocument(id: string, changes: Partial<DocumentRecord>): DocumentRecord {
    return updateStoredRecord(this.documents, id, changes);
  }

  listDocuments(): DocumentRecord[] {
    return Array.from(this.documents.values(), cloneRecord);
  }

  createClaim(record: ClaimRecord): ClaimRecord {
    this.claims.set(record.id, cloneRecord(record));
    return cloneRecord(record);
  }

  getClaim(id: string): ClaimRecord | undefined {
    const record = this.claims.get(id);
    return record ? cloneRecord(record) : undefined;
  }

  updateClaim(id: string, changes: Partial<ClaimRecord>): ClaimRecord {
    return updateStoredRecord(this.claims, id, changes);
  }

  listClaims(): ClaimRecord[] {
    return Array.from(this.claims.values(), cloneRecord);
  }

  createClaimEvidence(record: ClaimEvidenceRecord): ClaimEvidenceRecord {
    this.claimEvidence.set(record.id, cloneRecord(record));
    return cloneRecord(record);
  }

  getClaimEvidence(id: string): ClaimEvidenceRecord | undefined {
    const record = this.claimEvidence.get(id);
    return record ? cloneRecord(record) : undefined;
  }

  listClaimEvidence(): ClaimEvidenceRecord[] {
    return Array.from(this.claimEvidence.values(), cloneRecord);
  }

  listClaimEvidenceByClaimId(claimId: string): ClaimEvidenceRecord[] {
    return this.listClaimEvidence().filter((evidence) => evidence.claimId === claimId);
  }

  createAuditLog(record: AuditLogRecord): AuditLogRecord {
    this.auditLogs.set(record.id, cloneRecord(record));
    return cloneRecord(record);
  }

  listAuditLogs(): AuditLogRecord[] {
    return Array.from(this.auditLogs.values(), cloneRecord);
  }

  createReviewQueueItem(record: ReviewQueueRecord): ReviewQueueRecord {
    this.reviewQueueItems.set(record.id, cloneRecord(record));
    return cloneRecord(record);
  }

  getReviewQueueItem(id: string): ReviewQueueRecord | undefined {
    const record = this.reviewQueueItems.get(id);
    return record ? cloneRecord(record) : undefined;
  }

  updateReviewQueueItem(id: string, changes: Partial<ReviewQueueRecord>): ReviewQueueRecord {
    return updateStoredRecord(this.reviewQueueItems, id, changes);
  }

  listReviewQueueItems(): ReviewQueueRecord[] {
    return Array.from(this.reviewQueueItems.values(), cloneRecord);
  }

  listReviewQueueItemsByClaimId(claimId: string): ReviewQueueRecord[] {
    return this.listReviewQueueItems().filter((item) => item.claimId === claimId);
  }

  createLlmRun(record: LlmRunRecord): LlmRunRecord {
    this.llmRuns.set(record.id, cloneRecord(record));
    return cloneRecord(record);
  }

  getLlmRun(id: string): LlmRunRecord | undefined {
    const record = this.llmRuns.get(id);
    return record ? cloneRecord(record) : undefined;
  }

  listLlmRuns(): LlmRunRecord[] {
    return Array.from(this.llmRuns.values(), cloneRecord);
  }

  createEntityResolutionTask(record: EntityResolutionTaskRecord): EntityResolutionTaskRecord {
    this.entityResolutionTasks.set(record.id, cloneRecord(record));
    return cloneRecord(record);
  }

  getEntityResolutionTask(id: string): EntityResolutionTaskRecord | undefined {
    const record = this.entityResolutionTasks.get(id);
    return record ? cloneRecord(record) : undefined;
  }

  listEntityResolutionTasks(): EntityResolutionTaskRecord[] {
    return Array.from(this.entityResolutionTasks.values(), cloneRecord);
  }

  createEntityResolutionCandidate(
    record: EntityResolutionCandidateRecord,
  ): EntityResolutionCandidateRecord {
    this.entityResolutionCandidates.set(record.id, cloneRecord(record));
    return cloneRecord(record);
  }

  listEntityResolutionCandidatesByTaskId(taskId: string): EntityResolutionCandidateRecord[] {
    return Array.from(this.entityResolutionCandidates.values(), cloneRecord).filter(
      (candidate) => candidate.taskId === taskId,
    );
  }
}
