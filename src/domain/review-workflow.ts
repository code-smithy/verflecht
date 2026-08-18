import { randomUUID } from "node:crypto";

import type {
  ClaimEvidenceDraft,
  ClaimEvidenceRecord,
  ClaimRecord,
  ClaimRecordDraft,
  DocumentRecord,
  EntityRecord,
  EntityResolutionCandidateRecord,
  EntityResolutionTaskRecord,
  JsonRecord,
  ReviewQueueRecord,
  SourceRecord,
} from "./records";
import type { ResearchRepository } from "./repository";
import { type EditorialActor, ResearchDomainService } from "./services";

export type ReviewWorkflowOptions = {
  clock?: () => Date;
  idFactory?: () => string;
};

export type QueueClaimOptions = {
  assignedTo?: string;
  reason?: string;
  payload?: JsonRecord;
};

export type ReviewEvidenceDetail = {
  evidence: ClaimEvidenceRecord;
  document?: DocumentRecord;
  source?: SourceRecord;
};

export type ReviewEntityResolutionDetail = {
  task: EntityResolutionTaskRecord;
  candidates: Array<{
    candidate: EntityResolutionCandidateRecord;
    entity?: EntityRecord;
  }>;
};

export type ClaimReviewItem = {
  queue?: ReviewQueueRecord;
  claim: ClaimRecord;
  subject?: EntityRecord;
  object?: EntityRecord;
  evidence: ReviewEvidenceDetail[];
  entityResolution: ReviewEntityResolutionDetail[];
  llmConfidence?: number;
  evidenceScore?: number;
  sourceQualities: string[];
};

export type ListReviewItemsOptions = {
  includeResolved?: boolean;
  includeUnqueuedCandidates?: boolean;
};

export type EditVerifiedClaimInput = {
  claimId: string;
  replacement: Omit<ClaimRecordDraft, "verificationStatus" | "supersedesClaimId">;
  evidence: Array<Omit<ClaimEvidenceDraft, "claimId">>;
  actor: EditorialActor;
  reviewerNotes?: string;
};

function entityAuditValue(entity: EntityRecord): JsonRecord {
  return {
    entityType: entity.entityType,
    canonicalName: entity.canonicalName,
    slug: entity.slug,
    metadata: entity.metadata,
  };
}

function queueIsActive(queue: ReviewQueueRecord): boolean {
  return queue.status === "OPEN" || queue.status === "ASSIGNED";
}

export class ReviewWorkflowService {
  private readonly clock: () => Date;
  private readonly idFactory: () => string;

  constructor(
    private readonly repository: ResearchRepository,
    private readonly domain: ResearchDomainService,
    options: ReviewWorkflowOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  queueClaimForReview(claimId: string, options: QueueClaimOptions = {}): ReviewQueueRecord {
    const claim = this.repository.getClaim(claimId);

    if (!claim) {
      throw new Error("Cannot queue an unknown claim for review.");
    }

    const existing = this.repository
      .listReviewQueueItemsByClaimId(claimId)
      .find((item) => queueIsActive(item));

    if (existing) {
      return existing;
    }

    const now = this.clock();
    return this.repository.createReviewQueueItem({
      id: this.idFactory(),
      claimId,
      status: options.assignedTo ? "ASSIGNED" : "OPEN",
      assignedTo: options.assignedTo,
      reason: options.reason,
      payload: options.payload ?? {},
      createdAt: now,
      updatedAt: now,
    });
  }

  listReviewItems(options: ListReviewItemsOptions = {}): ClaimReviewItem[] {
    const includeUnqueuedCandidates = options.includeUnqueuedCandidates ?? true;
    const queuedClaimIds = new Set<string>();
    const items = this.repository
      .listReviewQueueItems()
      .filter((queue) => options.includeResolved || queueIsActive(queue))
      .flatMap((queue): ClaimReviewItem[] => {
        const claim = this.repository.getClaim(queue.claimId);

        if (!claim) {
          return [];
        }

        queuedClaimIds.add(claim.id);
        return [this.buildReviewItem(claim, queue)];
      });

    if (includeUnqueuedCandidates) {
      for (const claim of this.repository.listClaims()) {
        if (
          !queuedClaimIds.has(claim.id) &&
          (claim.verificationStatus === "DETECTED" ||
            claim.verificationStatus === "PENDING_REVIEW" ||
            claim.verificationStatus === "DISPUTED")
        ) {
          items.push(this.buildReviewItem(claim));
        }
      }
    }

    return items.sort(
      (left, right) =>
        (left.queue?.createdAt ?? left.claim.createdAt).getTime() -
        (right.queue?.createdAt ?? right.claim.createdAt).getTime(),
    );
  }

  verifyClaim(claimId: string, actor: EditorialActor, reviewerNotes?: string): ClaimRecord {
    const claim = this.domain.verifyClaim(claimId, actor);
    this.resolveReviewQueue(claimId, reviewerNotes);
    return claim;
  }

  rejectClaim(claimId: string, actor: EditorialActor, reviewerNotes?: string): ClaimRecord {
    const claim = this.domain.rejectClaim(claimId, actor);
    this.resolveReviewQueue(claimId, reviewerNotes);
    return claim;
  }

  markClaimDisputed(claimId: string, actor: EditorialActor, reviewerNotes?: string): ClaimRecord {
    const claim = this.domain.markClaimDisputed(claimId, actor);
    this.resolveReviewQueue(claimId, reviewerNotes);
    return claim;
  }

  editVerifiedClaim(input: EditVerifiedClaimInput): ClaimRecord {
    if (input.evidence.length === 0) {
      throw new Error("Edited verified claims require replacement evidence.");
    }

    const replacement = this.domain.supersedeVerifiedClaim(
      input.claimId,
      input.replacement,
      input.actor,
    );

    for (const evidence of input.evidence) {
      this.domain.addClaimEvidence({
        ...evidence,
        claimId: replacement.id,
      });
    }

    const verifiedReplacement = this.domain.verifyClaim(replacement.id, input.actor);
    this.resolveReviewQueue(input.claimId, input.reviewerNotes);
    this.resolveReviewQueue(replacement.id, input.reviewerNotes);
    return verifiedReplacement;
  }

  createEntityForReview(
    draft: Parameters<ResearchDomainService["createEntity"]>[0],
    actor: EditorialActor,
  ): EntityRecord {
    const entity = this.domain.createEntity(draft);

    this.writeAuditLog(
      actor,
      "ENTITY_CREATED",
      "entity",
      entity.id,
      undefined,
      entityAuditValue(entity),
    );

    return entity;
  }

  mergeEntities(
    sourceEntityId: string,
    targetEntityId: string,
    actor: EditorialActor,
  ): EntityRecord {
    if (sourceEntityId === targetEntityId) {
      throw new Error("Cannot merge an entity into itself.");
    }

    const source = this.repository.getEntity(sourceEntityId);
    const target = this.repository.getEntity(targetEntityId);

    if (!source || !target) {
      throw new Error("Cannot merge unknown entities.");
    }

    if (source.entityType !== target.entityType) {
      throw new Error("Only entities with the same type can be merged.");
    }

    for (const claim of this.repository.listClaims()) {
      const subjectEntityId =
        claim.subjectEntityId === sourceEntityId ? targetEntityId : claim.subjectEntityId;
      const objectEntityId =
        claim.objectEntityId === sourceEntityId ? targetEntityId : claim.objectEntityId;

      if (objectEntityId && subjectEntityId === objectEntityId) {
        throw new Error("Cannot merge entities while claims would become self-relations.");
      }
    }

    for (const claim of this.repository.listClaims()) {
      const changes: Partial<ClaimRecord> = {};

      if (claim.subjectEntityId === sourceEntityId) {
        changes.subjectEntityId = targetEntityId;
      }

      if (claim.objectEntityId === sourceEntityId) {
        changes.objectEntityId = targetEntityId;
      }

      if (Object.keys(changes).length > 0) {
        this.repository.updateClaim(claim.id, {
          ...changes,
          updatedAt: this.clock(),
        });
      }
    }

    const previousValue = entityAuditValue(source);
    const updatedSource = this.repository.updateEntity(sourceEntityId, {
      metadata: {
        ...source.metadata,
        mergedIntoEntityId: targetEntityId,
        mergedAt: this.clock().toISOString(),
      },
      updatedAt: this.clock(),
    });

    this.writeAuditLog(actor, "ENTITY_MERGED", "entity", sourceEntityId, previousValue, {
      ...entityAuditValue(updatedSource),
      targetEntityId,
    });

    return updatedSource;
  }

  private buildReviewItem(claim: ClaimRecord, queue?: ReviewQueueRecord): ClaimReviewItem {
    const evidence = this.repository
      .listClaimEvidenceByClaimId(claim.id)
      .map((claimEvidence): ReviewEvidenceDetail => {
        const document = this.repository.getDocument(claimEvidence.documentId);
        const source = document ? this.repository.getSource(document.sourceId) : undefined;

        return { evidence: claimEvidence, document, source };
      });
    const documentIds = new Set(
      evidence.flatMap((detail) => (detail.document ? [detail.document.id] : [])),
    );
    const entityResolution = this.repository
      .listEntityResolutionTasks()
      .filter((task) => task.documentId && documentIds.has(task.documentId))
      .map((task): ReviewEntityResolutionDetail => {
        const candidates = this.repository
          .listEntityResolutionCandidatesByTaskId(task.id)
          .map((candidate) => ({
            candidate,
            entity: this.repository.getEntity(candidate.candidateEntityId),
          }));

        return { task, candidates };
      });

    return {
      queue,
      claim,
      subject: this.repository.getEntity(claim.subjectEntityId),
      object: claim.objectEntityId ? this.repository.getEntity(claim.objectEntityId) : undefined,
      evidence,
      entityResolution,
      llmConfidence: claim.confidenceScore,
      evidenceScore: claim.evidenceScore,
      sourceQualities: Array.from(
        new Set(evidence.flatMap((detail) => (detail.source ? [detail.source.sourceQuality] : []))),
      ),
    };
  }

  private resolveReviewQueue(claimId: string, reviewerNotes?: string): void {
    for (const queue of this.repository.listReviewQueueItemsByClaimId(claimId)) {
      if (queueIsActive(queue)) {
        this.repository.updateReviewQueueItem(queue.id, {
          status: "RESOLVED",
          reviewerNotes,
          updatedAt: this.clock(),
        });
      }
    }
  }

  private writeAuditLog(
    actor: EditorialActor,
    action: string,
    entityType: string,
    entityId: string,
    previousValue?: JsonRecord,
    newValue?: JsonRecord,
  ): void {
    this.repository.createAuditLog({
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
