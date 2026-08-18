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
  topic?: string;
  person?: string;
  organization?: string;
  dateFrom?: string;
  dateTo?: string;
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

export type PublicEntityAlias = {
  id: string;
  alias: string;
  language?: string;
  validFrom?: string;
  validTo?: string;
};

export type PublicEntityDetail = {
  entity: PublicGraphNode;
  aliases: PublicEntityAlias[];
  claims: PublicGraphEdge[];
  connectedEntities: PublicGraphNode[];
  events: PublicGraphNode[];
  sources: PublicGraphEvidence["source"][];
  timeline: Array<{
    claimId: string;
    predicate: RelationPredicate;
    connectionClass: ConnectionClass;
    validFrom?: string;
    validTo?: string;
    connectedEntity: PublicGraphNode;
    evidence: PublicGraphEvidence[];
  }>;
};

export type PublicClaimDetail = PublicGraphEdge & {
  subject: PublicGraphNode;
  object: PublicGraphNode;
  verificationStatus: "VERIFIED";
};

type SourceBackedEvidence = {
  evidence: ClaimEvidenceRecord;
  document: DocumentRecord;
  source: SourceRecord;
};

const organizationEntityTypes = new Set<EntityType>([
  "ORGANISATION",
  "COMPANY",
  "POLITICAL_PARTY",
  "COMMITTEE",
  "PARLIAMENT",
  "GOVERNMENT_BODY",
  "ASSOCIATION",
  "MEDIA_OUTLET",
]);

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

  getPublicEntityDetail(entityId: string): PublicEntityDetail | undefined {
    const graph = this.getPublicGraph({ entityId });
    const entity = graph.nodes.find((node) => node.id === entityId);

    if (!entity) {
      return undefined;
    }

    const connectedEntitiesById = new Map<string, PublicGraphNode>();
    const eventsById = new Map<string, PublicGraphNode>();
    const sourcesById = new Map<string, PublicGraphEvidence["source"]>();
    const timeline: PublicEntityDetail["timeline"] = [];

    for (const edge of graph.edges) {
      const connectedEntityId =
        edge.subjectEntityId === entityId ? edge.objectEntityId : edge.subjectEntityId;
      const connectedEntity = graph.nodes.find((node) => node.id === connectedEntityId);

      if (!connectedEntity) {
        continue;
      }

      connectedEntitiesById.set(connectedEntity.id, connectedEntity);

      if (connectedEntity.entityType === "EVENT") {
        eventsById.set(connectedEntity.id, connectedEntity);
      }

      for (const evidence of edge.evidence) {
        sourcesById.set(evidence.source.id, evidence.source);
      }

      timeline.push({
        claimId: edge.id,
        predicate: edge.predicate,
        connectionClass: edge.connectionClass,
        validFrom: edge.validFrom,
        validTo: edge.validTo,
        connectedEntity,
        evidence: edge.evidence,
      });
    }

    return {
      entity,
      aliases: this.repository
        .listEntityAliasesByEntityId(entityId)
        .map((alias) => ({
          id: alias.id,
          alias: alias.alias,
          language: alias.language,
          validFrom: alias.validFrom,
          validTo: alias.validTo,
        }))
        .sort((left, right) => left.alias.localeCompare(right.alias)),
      claims: graph.edges,
      connectedEntities: Array.from(connectedEntitiesById.values()).sort(compareNodeNames),
      events: Array.from(eventsById.values()).sort(compareNodeNames),
      sources: Array.from(sourcesById.values()).sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
      timeline: timeline.sort(compareTimelineEntries),
    };
  }

  getPublicClaimDetail(claimId: string): PublicClaimDetail | undefined {
    const claim = this.repository.getClaim(claimId);

    if (!claim) {
      return undefined;
    }

    const edge = this.projectClaim(claim, {});

    if (!edge) {
      return undefined;
    }

    const subject = this.repository.getEntity(edge.subjectEntityId);
    const object = this.repository.getEntity(edge.objectEntityId);

    if (!subject || !object) {
      return undefined;
    }

    return {
      ...edge,
      subject: this.projectNode(subject),
      object: this.projectNode(object),
      verificationStatus: "VERIFIED",
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

    if (!this.claimMatchesDateRange(claim, filters)) {
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

    if (filters.topic && !this.claimMatchesTopic(claim, subject, object, filters.topic)) {
      return undefined;
    }

    if (
      filters.person &&
      !this.claimMatchesEntitySelector(subject, object, "PERSON", filters.person)
    ) {
      return undefined;
    }

    if (
      filters.organization &&
      !this.claimMatchesOrganizationSelector(subject, object, filters.organization)
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

  private claimMatchesDateRange(claim: ClaimRecord, filters: PublicGraphFilters): boolean {
    if (!filters.dateFrom && !filters.dateTo) {
      return true;
    }

    if (!claim.validFrom && !claim.validTo) {
      return false;
    }

    const claimStart = claim.validFrom ?? claim.validTo;
    const claimEnd = claim.validTo ?? claim.validFrom;

    if (filters.dateFrom && claimEnd && claimEnd < filters.dateFrom) {
      return false;
    }

    if (filters.dateTo && claimStart && claimStart > filters.dateTo) {
      return false;
    }

    return true;
  }

  private claimMatchesTopic(
    claim: ClaimRecord,
    subject: EntityRecord,
    object: EntityRecord,
    topic: string,
  ): boolean {
    return (
      metadataContainsToken(claim.validationNotes ?? {}, topic) ||
      metadataContainsToken(subject.metadata, topic) ||
      metadataContainsToken(object.metadata, topic)
    );
  }

  private claimMatchesEntitySelector(
    subject: EntityRecord,
    object: EntityRecord,
    entityType: EntityType,
    selector: string,
  ): boolean {
    return [subject, object].some(
      (entity) => entity.entityType === entityType && entityMatchesSelector(entity, selector),
    );
  }

  private claimMatchesOrganizationSelector(
    subject: EntityRecord,
    object: EntityRecord,
    selector: string,
  ): boolean {
    return [subject, object].some(
      (entity) =>
        organizationEntityTypes.has(entity.entityType) && entityMatchesSelector(entity, selector),
    );
  }
}

function compareNodeNames(left: PublicGraphNode, right: PublicGraphNode): number {
  return left.canonicalName.localeCompare(right.canonicalName);
}

function compareTimelineEntries(
  left: PublicEntityDetail["timeline"][number],
  right: PublicEntityDetail["timeline"][number],
): number {
  return (
    (left.validFrom ?? left.validTo ?? "").localeCompare(right.validFrom ?? right.validTo ?? "") ||
    left.connectedEntity.canonicalName.localeCompare(right.connectedEntity.canonicalName)
  );
}

function entityMatchesSelector(entity: EntityRecord, selector: string): boolean {
  const normalizedSelector = selector.trim().toLocaleLowerCase();

  return [entity.id, entity.slug, entity.canonicalName].some(
    (value) => value.toLocaleLowerCase() === normalizedSelector,
  );
}

function metadataContainsToken(metadata: Record<string, unknown>, token: string): boolean {
  const normalizedToken = token.trim().toLocaleLowerCase();

  if (!normalizedToken) {
    return false;
  }

  return Object.values(metadata).some((value) => valueContainsToken(value, normalizedToken));
}

function valueContainsToken(value: unknown, normalizedToken: string): boolean {
  if (typeof value === "string") {
    return value.toLocaleLowerCase() === normalizedToken;
  }

  if (Array.isArray(value)) {
    return value.some((item) => valueContainsToken(item, normalizedToken));
  }

  if (value && typeof value === "object") {
    return Object.values(value).some((item) => valueContainsToken(item, normalizedToken));
  }

  return false;
}
