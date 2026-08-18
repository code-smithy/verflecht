import { createHash, randomUUID } from "node:crypto";

import { isPredicateCompatible, type VerificationStatus } from "./ontology";
import type { ResearchRepository } from "./repository";
import type {
  AuditLogRecord,
  ClaimEvidenceDraft,
  ClaimEvidenceRecord,
  ClaimRecord,
  ClaimRecordDraft,
  CrawlScheduleDraft,
  CrawlScheduleFrequency,
  CrawlScheduleRecord,
  CrawlRunDraft,
  CrawlRunRecord,
  DocumentDraft,
  DocumentRecord,
  EntityAliasDraft,
  EntityAliasRecord,
  EntityDraft,
  EntityRecord,
  IngestionJobDraft,
  IngestionJobKind,
  IngestionJobRecord,
  JsonRecord,
  SourceDraft,
  SourceRecord,
  UrlCandidateDraft,
  UrlCandidateRecord,
} from "./records";
import type { ExtractionStatus } from "./ontology";

export type ResearchDomainServiceOptions = {
  clock?: () => Date;
  idFactory?: () => string;
};

export type EditorialActor = {
  actorId: string;
};

export type DocumentExtractionDraft = {
  title?: string;
  author?: string;
  publisher?: string;
  publishedAt?: Date;
  description?: string;
  language?: string;
  extractedText?: string;
  extractionStatus: ExtractionStatus;
  metadata?: JsonRecord;
};

type ReviewerStatus = Extract<
  VerificationStatus,
  "VERIFIED" | "REJECTED" | "DISPUTED" | "OUTDATED"
>;

function hashEvidenceText(evidenceText: string): string {
  return createHash("sha256").update(evidenceText).digest("hex");
}

function assertNonEmpty(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must not be empty.`);
  }
}

function assertDateRange(validFrom?: string, validTo?: string): void {
  if (validFrom && validTo && validFrom > validTo) {
    throw new Error("validFrom must be before or equal to validTo.");
  }
}

function claimAuditValue(claim: ClaimRecord): JsonRecord {
  return {
    predicate: claim.predicate,
    connectionClass: claim.connectionClass,
    verificationStatus: claim.verificationStatus,
    subjectEntityId: claim.subjectEntityId,
    objectEntityId: claim.objectEntityId,
    supersedesClaimId: claim.supersedesClaimId,
  };
}

function nextRunAfter(date: Date, frequency: CrawlScheduleFrequency): Date {
  const next = new Date(date);

  if (frequency === "HOURLY") {
    next.setUTCHours(next.getUTCHours() + 1);
    return next;
  }

  if (frequency === "DAILY") {
    next.setUTCDate(next.getUTCDate() + 1);
    return next;
  }

  if (frequency === "WEEKLY") {
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }

  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

function retryDelayMs(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60 * 1000;
}

export class ResearchDomainService {
  private readonly clock: () => Date;
  private readonly idFactory: () => string;

  constructor(
    private readonly repository: ResearchRepository,
    options: ResearchDomainServiceOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  createEntity(draft: EntityDraft): EntityRecord {
    assertNonEmpty(draft.canonicalName, "canonicalName");
    assertNonEmpty(draft.slug, "slug");

    const now = this.clock();
    return this.repository.createEntity({
      ...draft,
      id: this.idFactory(),
      createdAt: now,
      updatedAt: now,
    });
  }

  createEntityAlias(draft: EntityAliasDraft): EntityAliasRecord {
    assertNonEmpty(draft.alias, "alias");
    assertDateRange(draft.validFrom, draft.validTo);

    if (!this.repository.getEntity(draft.entityId)) {
      throw new Error("Cannot create an alias for an unknown entity.");
    }

    if (draft.sourceId && !this.repository.getSource(draft.sourceId)) {
      throw new Error("Cannot create an alias from an unknown source.");
    }

    return this.repository.createEntityAlias({
      ...draft,
      alias: draft.alias.trim(),
      id: this.idFactory(),
      createdAt: this.clock(),
    });
  }

  createSource(draft: SourceDraft): SourceRecord {
    assertNonEmpty(draft.name, "name");

    const now = this.clock();
    return this.repository.createSource({
      ...draft,
      id: this.idFactory(),
      createdAt: now,
      updatedAt: now,
    });
  }

  createDocument(draft: DocumentDraft): DocumentRecord {
    assertNonEmpty(draft.originalUrl, "originalUrl");

    if (!this.repository.getSource(draft.sourceId)) {
      throw new Error("Cannot create a document for an unknown source.");
    }

    const now = this.clock();
    return this.repository.createDocument({
      ...draft,
      id: this.idFactory(),
      retrievedAt: draft.retrievedAt ?? now,
      createdAt: now,
      updatedAt: now,
    });
  }

  createCrawlRun(draft: CrawlRunDraft): CrawlRunRecord {
    if (!this.repository.getSource(draft.sourceId)) {
      throw new Error("Cannot create a crawl run for an unknown source.");
    }

    if (draft.finishedAt && draft.finishedAt < draft.startedAt) {
      throw new Error("crawl run finishedAt must be after startedAt.");
    }

    const now = this.clock();
    return this.repository.createCrawlRun({
      ...draft,
      id: this.idFactory(),
      createdAt: now,
      updatedAt: now,
    });
  }

  updateCrawlRun(crawlRunId: string, changes: Partial<CrawlRunRecord>): CrawlRunRecord {
    const current = this.repository.getCrawlRun(crawlRunId);

    if (!current) {
      throw new Error("Crawl run does not exist.");
    }

    if (changes.finishedAt && (changes.startedAt ?? current.startedAt) > changes.finishedAt) {
      throw new Error("crawl run finishedAt must be after startedAt.");
    }

    return this.repository.updateCrawlRun(crawlRunId, {
      ...changes,
      updatedAt: this.clock(),
    });
  }

  createCrawlSchedule(draft: CrawlScheduleDraft): CrawlScheduleRecord {
    if (!this.repository.getSource(draft.sourceId)) {
      throw new Error("Cannot create a crawl schedule for an unknown source.");
    }

    if (draft.discoveryUrls.length === 0) {
      throw new Error("Crawl schedules require at least one discovery URL.");
    }

    for (const url of draft.discoveryUrls) {
      assertNonEmpty(url, "discoveryUrl");
    }

    const now = this.clock();
    return this.repository.createCrawlSchedule({
      ...draft,
      discoveryUrls: [...draft.discoveryUrls],
      id: this.idFactory(),
      createdAt: now,
      updatedAt: now,
    });
  }

  updateCrawlSchedule(
    scheduleId: string,
    changes: Partial<CrawlScheduleRecord>,
  ): CrawlScheduleRecord {
    const current = this.repository.getCrawlSchedule(scheduleId);

    if (!current) {
      throw new Error("Crawl schedule does not exist.");
    }

    if (changes.discoveryUrls && changes.discoveryUrls.length === 0) {
      throw new Error("Crawl schedules require at least one discovery URL.");
    }

    const update: Partial<CrawlScheduleRecord> = {
      ...changes,
      updatedAt: this.clock(),
    };

    if (changes.discoveryUrls) {
      update.discoveryUrls = [...changes.discoveryUrls];
    }

    return this.repository.updateCrawlSchedule(scheduleId, update);
  }

  listDueCrawlSchedules(at: Date = this.clock()): CrawlScheduleRecord[] {
    return this.repository
      .listCrawlSchedules()
      .filter((schedule) => schedule.status === "ACTIVE" && schedule.nextRunAt <= at)
      .sort((left, right) => left.nextRunAt.getTime() - right.nextRunAt.getTime());
  }

  markCrawlScheduleRun(scheduleId: string, runAt: Date = this.clock()): CrawlScheduleRecord {
    const schedule = this.repository.getCrawlSchedule(scheduleId);

    if (!schedule) {
      throw new Error("Crawl schedule does not exist.");
    }

    return this.updateCrawlSchedule(scheduleId, {
      lastRunAt: runAt,
      nextRunAt: nextRunAfter(runAt, schedule.frequency),
    });
  }

  createIngestionJob(draft: IngestionJobDraft): IngestionJobRecord {
    this.assertIngestionJobReferencesExist(draft);

    if (draft.attempts < 0) {
      throw new Error("Ingestion job attempts cannot be negative.");
    }

    if (draft.maxAttempts < 1) {
      throw new Error("Ingestion jobs require at least one allowed attempt.");
    }

    const now = this.clock();
    return this.repository.createIngestionJob({
      ...draft,
      id: this.idFactory(),
      createdAt: now,
      updatedAt: now,
    });
  }

  createOrReuseUrlCandidateJob(
    urlCandidateId: string,
    jobKind: Extract<IngestionJobKind, "FETCH_URL">,
    options: { scheduledAt?: Date; maxAttempts?: number; metadata?: JsonRecord } = {},
  ): IngestionJobRecord {
    const candidate = this.repository.getUrlCandidate(urlCandidateId);

    if (!candidate) {
      throw new Error("Cannot create an ingestion job for an unknown URL candidate.");
    }

    const existing = this.repository.findActiveIngestionJobForUrlCandidate(urlCandidateId, jobKind);

    if (existing) {
      return existing;
    }

    return this.createIngestionJob({
      sourceId: candidate.sourceId,
      crawlRunId: candidate.crawlRunId,
      urlCandidateId,
      jobKind,
      status: "PENDING",
      attempts: 0,
      maxAttempts: options.maxAttempts ?? 3,
      scheduledAt: options.scheduledAt ?? this.clock(),
      metadata: options.metadata ?? {},
    });
  }

  createOrReuseDocumentJob(
    documentId: string,
    jobKind: Extract<IngestionJobKind, "EXTRACT_DOCUMENT" | "ANALYZE_DOCUMENT">,
    options: { scheduledAt?: Date; maxAttempts?: number; metadata?: JsonRecord } = {},
  ): IngestionJobRecord {
    const document = this.repository.getDocument(documentId);

    if (!document) {
      throw new Error("Cannot create an ingestion job for an unknown document.");
    }

    const existing = this.repository.findIngestionJobForDocument(documentId, jobKind);

    if (existing) {
      return existing;
    }

    return this.createIngestionJob({
      sourceId: document.sourceId,
      documentId,
      jobKind,
      status: "PENDING",
      attempts: 0,
      maxAttempts: options.maxAttempts ?? 3,
      scheduledAt: options.scheduledAt ?? this.clock(),
      metadata: options.metadata ?? {},
    });
  }

  listDueIngestionJobs(jobKind: IngestionJobKind, at: Date = this.clock()): IngestionJobRecord[] {
    return this.repository
      .listIngestionJobs()
      .filter((job) => job.jobKind === jobKind && job.status === "PENDING" && job.scheduledAt <= at)
      .sort((left, right) => left.scheduledAt.getTime() - right.scheduledAt.getTime());
  }

  startIngestionJob(jobId: string): IngestionJobRecord {
    const job = this.getExistingIngestionJob(jobId);

    if (job.status !== "PENDING") {
      throw new Error("Only pending ingestion jobs can be started.");
    }

    if (job.attempts >= job.maxAttempts) {
      throw new Error("Ingestion job has no retry attempts remaining.");
    }

    const now = this.clock();

    return this.repository.updateIngestionJob(jobId, {
      status: "RUNNING",
      attempts: job.attempts + 1,
      lockedAt: now,
      errorMessage: undefined,
      updatedAt: now,
    });
  }

  completeIngestionJob(
    jobId: string,
    metadata: JsonRecord = {},
    status: Extract<IngestionJobRecord["status"], "SUCCEEDED" | "SKIPPED"> = "SUCCEEDED",
  ): IngestionJobRecord {
    const job = this.getExistingIngestionJob(jobId);

    if (job.status !== "RUNNING") {
      throw new Error("Only running ingestion jobs can be completed.");
    }

    const now = this.clock();

    return this.repository.updateIngestionJob(jobId, {
      status,
      finishedAt: now,
      lockedAt: undefined,
      metadata: {
        ...job.metadata,
        ...metadata,
      },
      updatedAt: now,
    });
  }

  failIngestionJob(jobId: string, errorMessage: string): IngestionJobRecord {
    const job = this.getExistingIngestionJob(jobId);

    if (job.status !== "RUNNING") {
      throw new Error("Only running ingestion jobs can fail.");
    }

    const retryable = job.attempts < job.maxAttempts;

    const now = this.clock();

    return this.repository.updateIngestionJob(jobId, {
      status: retryable ? "PENDING" : "FAILED",
      scheduledAt: retryable
        ? new Date(now.getTime() + retryDelayMs(job.attempts))
        : job.scheduledAt,
      finishedAt: retryable ? undefined : now,
      lockedAt: undefined,
      errorMessage,
      updatedAt: now,
    });
  }

  createOrUpdateUrlCandidate(draft: UrlCandidateDraft): UrlCandidateRecord {
    assertNonEmpty(draft.originalUrl, "originalUrl");
    assertNonEmpty(draft.canonicalUrl, "canonicalUrl");

    if (!this.repository.getSource(draft.sourceId)) {
      throw new Error("Cannot create a URL candidate for an unknown source.");
    }

    if (draft.crawlRunId && !this.repository.getCrawlRun(draft.crawlRunId)) {
      throw new Error("Cannot create a URL candidate for an unknown crawl run.");
    }

    const existing = this.repository.getUrlCandidateByCanonicalUrl(
      draft.sourceId,
      draft.canonicalUrl,
    );
    const now = this.clock();

    if (existing) {
      return this.repository.updateUrlCandidate(existing.id, {
        ...draft,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now,
        metadata: {
          ...existing.metadata,
          ...draft.metadata,
          discoveryCount:
            typeof existing.metadata.discoveryCount === "number"
              ? existing.metadata.discoveryCount + 1
              : 2,
        },
      });
    }

    return this.repository.createUrlCandidate({
      ...draft,
      id: this.idFactory(),
      createdAt: now,
      updatedAt: now,
    });
  }

  updateDocumentExtraction(documentId: string, draft: DocumentExtractionDraft): DocumentRecord {
    const document = this.repository.getDocument(documentId);

    if (!document) {
      throw new Error("Document does not exist.");
    }

    return this.repository.updateDocument(documentId, {
      title: draft.title,
      author: draft.author,
      publisher: draft.publisher,
      publishedAt: draft.publishedAt,
      language: draft.language,
      extractedText: draft.extractedText,
      extractionStatus: draft.extractionStatus,
      metadata: {
        ...document.metadata,
        ...(draft.description ? { extractedDescription: draft.description } : {}),
        ...(draft.metadata ?? {}),
      },
      updatedAt: this.clock(),
    });
  }

  createClaim(draft: ClaimRecordDraft): ClaimRecord {
    this.assertClaimShapeCanExist(draft);

    if (draft.verificationStatus === "VERIFIED") {
      throw new Error("Claims must be verified through the reviewer transition service.");
    }

    const now = this.clock();
    return this.repository.createClaim({
      ...draft,
      id: this.idFactory(),
      createdAt: now,
      updatedAt: now,
    });
  }

  addClaimEvidence(draft: ClaimEvidenceDraft): ClaimEvidenceRecord {
    assertNonEmpty(draft.evidenceText, "evidenceText");

    if (!this.repository.getClaim(draft.claimId)) {
      throw new Error("Cannot add evidence to an unknown claim.");
    }

    if (!this.repository.getDocument(draft.documentId)) {
      throw new Error("Cannot add evidence from an unknown document.");
    }

    if (
      draft.startChar !== undefined &&
      draft.endChar !== undefined &&
      draft.startChar > draft.endChar
    ) {
      throw new Error("startChar must be before or equal to endChar.");
    }

    return this.repository.createClaimEvidence({
      ...draft,
      evidenceText: draft.evidenceText.trim(),
      id: this.idFactory(),
      evidenceHash: draft.evidenceHash ?? hashEvidenceText(draft.evidenceText.trim()),
      createdAt: this.clock(),
    });
  }

  verifyClaim(claimId: string, actor: EditorialActor): ClaimRecord {
    return this.transitionClaim(claimId, "VERIFIED", actor);
  }

  rejectClaim(claimId: string, actor: EditorialActor): ClaimRecord {
    return this.transitionClaim(claimId, "REJECTED", actor);
  }

  markClaimDisputed(claimId: string, actor: EditorialActor): ClaimRecord {
    return this.transitionClaim(claimId, "DISPUTED", actor);
  }

  markClaimOutdated(claimId: string, actor: EditorialActor): ClaimRecord {
    return this.transitionClaim(claimId, "OUTDATED", actor);
  }

  supersedeVerifiedClaim(
    claimId: string,
    replacementDraft: Omit<ClaimRecordDraft, "verificationStatus" | "supersedesClaimId">,
    actor: EditorialActor,
  ): ClaimRecord {
    const original = this.getExistingClaim(claimId);

    if (original.verificationStatus !== "VERIFIED") {
      throw new Error("Only verified claims can be superseded.");
    }

    const replacement = this.createClaim({
      ...replacementDraft,
      verificationStatus: "PENDING_REVIEW",
      supersedesClaimId: original.id,
    });

    this.transitionClaim(original.id, "OUTDATED", actor);
    this.writeAuditLog(actor, "CLAIM_SUPERSEDED", "claim", replacement.id, undefined, {
      supersedesClaimId: original.id,
    });

    return replacement;
  }

  private transitionClaim(
    claimId: string,
    verificationStatus: ReviewerStatus,
    actor: EditorialActor,
  ): ClaimRecord {
    const claim = this.getExistingClaim(claimId);
    const previousValue = claimAuditValue(claim);

    if (verificationStatus === "VERIFIED") {
      this.assertClaimCanBeVerified(claim);
    }

    const updated = this.repository.updateClaim(claimId, {
      verificationStatus,
      reviewedBy: actor.actorId,
      reviewedAt: this.clock(),
      updatedAt: this.clock(),
    });

    this.writeAuditLog(
      actor,
      `CLAIM_${verificationStatus}`,
      "claim",
      claimId,
      previousValue,
      claimAuditValue(updated),
    );

    return updated;
  }

  private assertClaimShapeCanExist(claim: ClaimRecordDraft): void {
    assertDateRange(claim.validFrom, claim.validTo);

    const subject = this.repository.getEntity(claim.subjectEntityId);
    if (!subject) {
      throw new Error("Claim subject entity does not exist.");
    }

    if (!claim.objectEntityId && !claim.literalValue) {
      throw new Error("A claim needs either an object entity or a literal value.");
    }

    if (claim.objectEntityId) {
      const object = this.repository.getEntity(claim.objectEntityId);

      if (!object) {
        throw new Error("Claim object entity does not exist.");
      }

      if (claim.objectEntityId === claim.subjectEntityId) {
        throw new Error("A claim cannot relate an entity to itself.");
      }

      if (!isPredicateCompatible(claim.predicate, subject.entityType, object.entityType)) {
        throw new Error("Claim predicate is incompatible with the subject or object entity type.");
      }
    }
  }

  private assertClaimCanBeVerified(claim: ClaimRecord): void {
    this.assertClaimShapeCanExist(claim);

    if (this.repository.listClaimEvidenceByClaimId(claim.id).length === 0) {
      throw new Error("A claim cannot be verified without evidence.");
    }

    if (claim.literalValue && !claim.objectEntityId) {
      throw new Error("Literal claims are not publishable graph relationships yet.");
    }
  }

  private getExistingClaim(claimId: string): ClaimRecord {
    const claim = this.repository.getClaim(claimId);

    if (!claim) {
      throw new Error("Claim does not exist.");
    }

    return claim;
  }

  private getExistingIngestionJob(jobId: string): IngestionJobRecord {
    const job = this.repository.getIngestionJob(jobId);

    if (!job) {
      throw new Error("Ingestion job does not exist.");
    }

    return job;
  }

  private assertIngestionJobReferencesExist(job: IngestionJobDraft): void {
    if (!this.repository.getSource(job.sourceId)) {
      throw new Error("Cannot create an ingestion job for an unknown source.");
    }

    if (job.crawlRunId && !this.repository.getCrawlRun(job.crawlRunId)) {
      throw new Error("Cannot create an ingestion job for an unknown crawl run.");
    }

    if (job.urlCandidateId && !this.repository.getUrlCandidate(job.urlCandidateId)) {
      throw new Error("Cannot create an ingestion job for an unknown URL candidate.");
    }

    if (job.documentId && !this.repository.getDocument(job.documentId)) {
      throw new Error("Cannot create an ingestion job for an unknown document.");
    }
  }

  private writeAuditLog(
    actor: EditorialActor,
    action: string,
    entityType: string,
    entityId: string,
    previousValue?: JsonRecord,
    newValue?: JsonRecord,
  ): AuditLogRecord {
    return this.repository.createAuditLog({
      id: this.idFactory(),
      actorId: actor.actorId,
      action,
      entityType,
      entityId,
      previousValue,
      newValue,
      createdAt: this.clock(),
    });
  }
}
