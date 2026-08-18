import { createHash, randomUUID } from "node:crypto";

import { isPredicateCompatible, type VerificationStatus } from "./ontology";
import type { ResearchRepository } from "./repository";
import type {
  AuditLogRecord,
  ClaimEvidenceDraft,
  ClaimEvidenceRecord,
  ClaimRecord,
  ClaimRecordDraft,
  DocumentDraft,
  DocumentRecord,
  EntityDraft,
  EntityRecord,
  JsonRecord,
  SourceDraft,
  SourceRecord,
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
