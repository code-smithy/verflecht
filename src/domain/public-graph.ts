import {
  isPredicateCompatible,
  type ConnectionClass,
  type EntityType,
  type RelationPredicate,
} from "./ontology";
import type { ResearchRepository } from "./repository";
import type {
  ClaimEvidenceRecord,
  ClaimRecord,
  DocumentRecord,
  EntityRecord,
  SourceRecord,
} from "./records";

export type PublicGraphFilters = {
  entityId?: string;
  entityType?: EntityType;
  predicate?: RelationPredicate;
  connectionClass?: ConnectionClass;
  includeHistorical?: boolean;
};

export type PublicGraphNode = {
  id: string;
  entityType: EntityType;
  canonicalName: string;
  slug: string;
  description?: string;
  countryCode?: string;
};

export type PublicGraphEvidence = {
  id: string;
  evidenceText: string;
  contextBefore?: string;
  contextAfter?: string;
  document: {
    id: string;
    url: string;
    title?: string;
    publisher?: string;
    publishedAt?: string;
    retrievedAt: string;
    accessStatus: string;
  };
  source: {
    id: string;
    name: string;
    sourceType: string;
    sourceQuality: string;
  };
};

export type PublicGraphEdge = {
  id: string;
  subjectEntityId: string;
  objectEntityId: string;
  predicate: RelationPredicate;
  connectionClass: ConnectionClass;
  validFrom?: string;
  validTo?: string;
  evidence: PublicGraphEvidence[];
};

export type PublicGraphProjection = {
  nodes: PublicGraphNode[];
  edges: PublicGraphEdge[];
};

type SourceBackedEvidence = {
  evidence: ClaimEvidenceRecord;
  document: DocumentRecord;
  source: SourceRecord;
};

export class PublicGraphService {
  constructor(private readonly repository: ResearchRepository) {}

  getPublicGraph(filters: PublicGraphFilters = {}): PublicGraphProjection {
    const nodesById = new Map<string, PublicGraphNode>();
    const edges: PublicGraphEdge[] = [];

    for (const claim of this.repository.listClaims()) {
      const edge = this.projectClaim(claim, filters);

      if (!edge) {
        continue;
      }

      const subject = this.repository.getEntity(edge.subjectEntityId);
      const object = this.repository.getEntity(edge.objectEntityId);

      if (!subject || !object) {
        continue;
      }

      nodesById.set(subject.id, this.projectNode(subject));
      nodesById.set(object.id, this.projectNode(object));
      edges.push(edge);
    }

    return {
      nodes: Array.from(nodesById.values()),
      edges,
    };
  }

  private projectClaim(
    claim: ClaimRecord,
    filters: PublicGraphFilters,
  ): PublicGraphEdge | undefined {
    if (claim.verificationStatus !== "VERIFIED" || !claim.objectEntityId) {
      return undefined;
    }

    if (filters.predicate && claim.predicate !== filters.predicate) {
      return undefined;
    }

    if (filters.connectionClass && claim.connectionClass !== filters.connectionClass) {
      return undefined;
    }

    if (filters.includeHistorical === false && claim.connectionClass === "HISTORICAL") {
      return undefined;
    }

    if (
      filters.entityId &&
      claim.subjectEntityId !== filters.entityId &&
      claim.objectEntityId !== filters.entityId
    ) {
      return undefined;
    }

    const subject = this.repository.getEntity(claim.subjectEntityId);
    const object = this.repository.getEntity(claim.objectEntityId);

    if (!subject || !object) {
      return undefined;
    }

    if (
      filters.entityType &&
      subject.entityType !== filters.entityType &&
      object.entityType !== filters.entityType
    ) {
      return undefined;
    }

    if (!isPredicateCompatible(claim.predicate, subject.entityType, object.entityType)) {
      return undefined;
    }

    const sourceBackedEvidence = this.getSourceBackedEvidence(claim.id);

    if (sourceBackedEvidence.length === 0) {
      return undefined;
    }

    return {
      id: claim.id,
      subjectEntityId: claim.subjectEntityId,
      objectEntityId: claim.objectEntityId,
      predicate: claim.predicate,
      connectionClass: claim.connectionClass,
      validFrom: claim.validFrom,
      validTo: claim.validTo,
      evidence: sourceBackedEvidence.map(({ evidence, document, source }) =>
        this.projectEvidence(evidence, document, source),
      ),
    };
  }

  private getSourceBackedEvidence(claimId: string): SourceBackedEvidence[] {
    return this.repository
      .listClaimEvidenceByClaimId(claimId)
      .flatMap((evidence): SourceBackedEvidence[] => {
        const document = this.repository.getDocument(evidence.documentId);
        const source = document ? this.repository.getSource(document.sourceId) : undefined;

        if (!document || !source) {
          return [];
        }

        return [{ evidence, document, source }];
      });
  }

  private projectNode(entity: EntityRecord): PublicGraphNode {
    return {
      id: entity.id,
      entityType: entity.entityType,
      canonicalName: entity.canonicalName,
      slug: entity.slug,
      description: entity.description,
      countryCode: entity.countryCode,
    };
  }

  private projectEvidence(
    evidence: ClaimEvidenceRecord,
    document: DocumentRecord,
    source: SourceRecord,
  ): PublicGraphEvidence {
    return {
      id: evidence.id,
      evidenceText: evidence.evidenceText,
      contextBefore: evidence.contextBefore,
      contextAfter: evidence.contextAfter,
      document: {
        id: document.id,
        url: document.canonicalUrl ?? document.originalUrl,
        title: document.title,
        publisher: document.publisher,
        publishedAt: document.publishedAt?.toISOString(),
        retrievedAt: document.retrievedAt.toISOString(),
        accessStatus: document.accessStatus,
      },
      source: {
        id: source.id,
        name: source.name,
        sourceType: source.sourceType,
        sourceQuality: source.sourceQuality,
      },
    };
  }
}
