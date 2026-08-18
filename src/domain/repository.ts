import type {
  AuditLogRecord,
  ClaimEvidenceRecord,
  ClaimRecord,
  DocumentRecord,
  EntityRecord,
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
  listEntities(): EntityRecord[];

  createSource(record: SourceRecord): SourceRecord;
  getSource(id: string): SourceRecord | undefined;
  listSources(): SourceRecord[];

  createDocument(record: DocumentRecord): DocumentRecord;
  getDocument(id: string): DocumentRecord | undefined;
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
};

export class InMemoryResearchRepository implements ResearchRepository {
  private readonly entities = new Map<string, EntityRecord>();
  private readonly sources = new Map<string, SourceRecord>();
  private readonly documents = new Map<string, DocumentRecord>();
  private readonly claims = new Map<string, ClaimRecord>();
  private readonly claimEvidence = new Map<string, ClaimEvidenceRecord>();
  private readonly auditLogs = new Map<string, AuditLogRecord>();

  createEntity(record: EntityRecord): EntityRecord {
    this.entities.set(record.id, cloneRecord(record));
    return cloneRecord(record);
  }

  getEntity(id: string): EntityRecord | undefined {
    const record = this.entities.get(id);
    return record ? cloneRecord(record) : undefined;
  }

  listEntities(): EntityRecord[] {
    return Array.from(this.entities.values(), cloneRecord);
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
}
