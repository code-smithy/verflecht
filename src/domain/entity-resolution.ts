import { randomUUID } from "node:crypto";

import type { EntityType } from "./ontology";
import type { ResearchRepository } from "./repository";
import type {
  EntityRecord,
  EntityResolutionCandidateRecord,
  EntityResolutionStatus,
  EntityResolutionTaskRecord,
  JsonRecord,
} from "./records";

export type EntityResolutionMention = {
  localId: string;
  entityType: EntityType;
  name: string;
  aliases?: string[];
  evidence?: string;
  metadata?: JsonRecord;
};

export type EntityResolutionOptions = {
  autoResolveThreshold?: number;
  candidateThreshold?: number;
  ambiguityDelta?: number;
  clock?: () => Date;
  idFactory?: () => string;
};

export type ResolveEntityMentionsInput = {
  documentId?: string;
  mentions: EntityResolutionMention[];
  coMentionedEntityIds?: string[];
};

export type EntityResolutionCandidate = {
  entityId: string;
  score: number;
  signals: string[];
};

export type EntityResolution = {
  localId: string;
  mention: string;
  entityType: EntityType;
  candidates: EntityResolutionCandidate[];
  selectedEntityId?: string;
  manualReviewRequired: boolean;
  status: EntityResolutionStatus;
  reason?: string;
};

export type EntityResolutionResult = {
  resolutions: EntityResolution[];
  reviewTasks: EntityResolutionTaskRecord[];
};

type ScoredCandidate = EntityResolutionCandidate & {
  entity: EntityRecord;
};

const DEFAULT_AUTO_RESOLVE_THRESHOLD = 0.82;
const DEFAULT_CANDIDATE_THRESHOLD = 0.2;
const DEFAULT_AMBIGUITY_DELTA = 0.08;

const partyKeys = ["party", "political_party"];
const cantonKeys = ["canton"];
const positionKeys = ["position", "office", "role", "title"];
const organisationKeys = ["organisation", "organization", "company"];
const countryKeys = ["country", "country_code", "countryCode"];

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/['']/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function tokenize(value: string): string[] {
  const normalized = normalizeText(value);
  return normalized ? normalized.split(/\s+/u) : [];
}

function metadataString(metadata: JsonRecord | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = metadata?.[key];

    if (typeof value === "string" && value.trim()) {
      return value;
    }

    if (typeof value === "number") {
      return String(value);
    }
  }

  return undefined;
}

function metadataStringArray(metadata: JsonRecord | undefined, keys: string[]): string[] {
  for (const key of keys) {
    const value = metadata?.[key];

    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string");
    }
  }

  return [];
}

function hasSameMetadataValue(
  mention: EntityResolutionMention,
  entity: EntityRecord,
  keys: string[],
): boolean {
  const mentionValue = metadataString(mention.metadata, keys);
  const entityValue = metadataString(entity.metadata, keys);

  return Boolean(
    mentionValue && entityValue && normalizeText(mentionValue) === normalizeText(entityValue),
  );
}

function sameCountry(mention: EntityResolutionMention, entity: EntityRecord): boolean {
  const mentionValue = metadataString(mention.metadata, countryKeys);
  const entityValue = metadataString(entity.metadata, countryKeys) ?? entity.countryCode;

  return Boolean(
    mentionValue && entityValue && normalizeText(mentionValue) === normalizeText(entityValue),
  );
}

function extractDateRange(metadata: JsonRecord | undefined): {
  from?: string;
  to?: string;
} {
  const from = metadataString(metadata, ["valid_from", "validFrom", "start_at", "startAt", "from"]);
  const to = metadataString(metadata, ["valid_to", "validTo", "end_at", "endAt", "to"]);

  return { from, to };
}

function rangesOverlap(
  left: { from?: string; to?: string },
  right: { from?: string; to?: string },
): boolean {
  if (!left.from && !left.to) {
    return false;
  }

  if (!right.from && !right.to) {
    return false;
  }

  const leftFrom = left.from ?? "0000-01-01";
  const leftTo = left.to ?? "9999-12-31";
  const rightFrom = right.from ?? "0000-01-01";
  const rightTo = right.to ?? "9999-12-31";

  return leftFrom <= rightTo && rightFrom <= leftTo;
}

function sameCoMentionedEntity(
  mention: EntityResolutionMention,
  entity: EntityRecord,
  inputCoMentionedEntityIds: string[],
): boolean {
  const mentionIds = new Set([
    ...metadataStringArray(mention.metadata, ["co_mentioned_entity_ids", "coMentionedEntityIds"]),
    ...inputCoMentionedEntityIds,
  ]);
  const entityIds = metadataStringArray(entity.metadata, [
    "co_mentioned_entity_ids",
    "coMentionedEntityIds",
    "related_entity_ids",
    "relatedEntityIds",
  ]);

  return entityIds.some((id) => mentionIds.has(id));
}

function lastToken(value: string): string | undefined {
  return tokenize(value).at(-1);
}

function namesContainEachOther(left: string, right: string): boolean {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);

  return (
    normalizedLeft.length > 0 &&
    normalizedRight.length > 0 &&
    (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft))
  );
}

export class EntityResolutionService {
  private readonly autoResolveThreshold: number;
  private readonly candidateThreshold: number;
  private readonly ambiguityDelta: number;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;

  constructor(
    private readonly repository: ResearchRepository,
    options: EntityResolutionOptions = {},
  ) {
    this.autoResolveThreshold = options.autoResolveThreshold ?? DEFAULT_AUTO_RESOLVE_THRESHOLD;
    this.candidateThreshold = options.candidateThreshold ?? DEFAULT_CANDIDATE_THRESHOLD;
    this.ambiguityDelta = options.ambiguityDelta ?? DEFAULT_AMBIGUITY_DELTA;
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  resolveMentions(input: ResolveEntityMentionsInput): EntityResolutionResult {
    const reviewTasks: EntityResolutionTaskRecord[] = [];
    const resolutions = input.mentions.map((mention) => {
      const candidates = this.scoreCandidates(mention, input.coMentionedEntityIds ?? []);
      const resolution = this.classifyResolution(mention, candidates);

      if (resolution.manualReviewRequired) {
        reviewTasks.push(this.createReviewTask(input.documentId, mention, resolution));
      }

      return resolution;
    });

    return { resolutions, reviewTasks };
  }

  private scoreCandidates(
    mention: EntityResolutionMention,
    coMentionedEntityIds: string[],
  ): ScoredCandidate[] {
    return this.repository
      .listEntities()
      .filter((entity) => entity.entityType === mention.entityType)
      .map((entity) => this.scoreCandidate(mention, entity, coMentionedEntityIds))
      .filter((candidate) => candidate.score >= this.candidateThreshold)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.entity.canonicalName.localeCompare(right.entity.canonicalName),
      );
  }

  private scoreCandidate(
    mention: EntityResolutionMention,
    entity: EntityRecord,
    coMentionedEntityIds: string[],
  ): ScoredCandidate {
    let score = 0;
    const signals = new Set<string>();
    const mentionNames = [mention.name, ...(mention.aliases ?? [])];
    const mentionNameTokens = new Set(mentionNames.flatMap(tokenize));
    const canonicalName = entity.canonicalName;
    const aliases = this.repository
      .listEntityAliasesByEntityId(entity.id)
      .map((alias) => alias.alias);
    const normalizedMentionNames = new Set(mentionNames.map(normalizeText));

    if (normalizedMentionNames.has(normalizeText(canonicalName))) {
      score += 0.86;
      signals.add("exact canonical name");
    } else if (aliases.some((alias) => normalizedMentionNames.has(normalizeText(alias)))) {
      score += 0.9;
      signals.add("exact alias");
    } else if (mention.entityType === "PERSON") {
      const surname = lastToken(canonicalName);

      if (surname && mentionNameTokens.has(surname)) {
        score += 0.34;
        signals.add("same surname");
      }
    } else if (mentionNames.some((name) => namesContainEachOther(name, canonicalName))) {
      score += 0.42;
      signals.add("partial name");
    }

    if (hasSameMetadataValue(mention, entity, partyKeys)) {
      score += 0.08;
      signals.add("same party");
    }

    if (hasSameMetadataValue(mention, entity, cantonKeys)) {
      score += 0.12;
      signals.add("same canton");
    }

    if (hasSameMetadataValue(mention, entity, positionKeys)) {
      score += 0.07;
      signals.add("same position");
    }

    if (hasSameMetadataValue(mention, entity, organisationKeys)) {
      score += 0.06;
      signals.add("same organisation");
    }

    if (sameCountry(mention, entity)) {
      score += 0.08;
      signals.add("same country");
    }

    if (rangesOverlap(extractDateRange(mention.metadata), extractDateRange(entity.metadata))) {
      score += 0.05;
      signals.add("overlapping time period");
    }

    if (sameCoMentionedEntity(mention, entity, coMentionedEntityIds)) {
      score += 0.05;
      signals.add("co-mentioned entity");
    }

    return {
      entity,
      entityId: entity.id,
      score: Math.min(1, Number(score.toFixed(4))),
      signals: Array.from(signals),
    };
  }

  private classifyResolution(
    mention: EntityResolutionMention,
    candidates: ScoredCandidate[],
  ): EntityResolution {
    const publicCandidates = candidates.map((candidate) => ({
      entityId: candidate.entityId,
      score: candidate.score,
      signals: candidate.signals,
    }));
    const top = candidates[0];
    const second = candidates[1];

    if (!top) {
      return {
        localId: mention.localId,
        mention: mention.name,
        entityType: mention.entityType,
        candidates: [],
        manualReviewRequired: true,
        status: "NO_MATCH",
        reason: "No candidate met the minimum score.",
      };
    }

    const ambiguous =
      Boolean(second && top.score - second.score <= this.ambiguityDelta) ||
      (mention.entityType === "PERSON" && this.hasAmbiguousPersonMatch(top, second));

    if (ambiguous) {
      return {
        localId: mention.localId,
        mention: mention.name,
        entityType: mention.entityType,
        candidates: publicCandidates,
        manualReviewRequired: true,
        status: "MANUAL_REVIEW",
        reason: "Ambiguous entity candidates require manual review.",
      };
    }

    if (top.score < this.autoResolveThreshold) {
      return {
        localId: mention.localId,
        mention: mention.name,
        entityType: mention.entityType,
        candidates: publicCandidates,
        manualReviewRequired: true,
        status: "MANUAL_REVIEW",
        reason: "Top candidate is below the automatic resolution threshold.",
      };
    }

    return {
      localId: mention.localId,
      mention: mention.name,
      entityType: mention.entityType,
      candidates: publicCandidates,
      selectedEntityId: top.entityId,
      manualReviewRequired: false,
      status: "AUTO_RESOLVED",
    };
  }

  private hasAmbiguousPersonMatch(
    top: ScoredCandidate,
    second: ScoredCandidate | undefined,
  ): boolean {
    if (!second) {
      return false;
    }

    const topSurname = lastToken(top.entity.canonicalName);
    const secondSurname = lastToken(second.entity.canonicalName);

    return Boolean(
      topSurname &&
      secondSurname &&
      topSurname === secondSurname &&
      top.signals.includes("same surname") &&
      second.signals.includes("same surname"),
    );
  }

  private createReviewTask(
    documentId: string | undefined,
    mention: EntityResolutionMention,
    resolution: EntityResolution,
  ): EntityResolutionTaskRecord {
    const now = this.clock();
    const task = this.repository.createEntityResolutionTask({
      id: this.idFactory(),
      documentId,
      localId: mention.localId,
      mentionText: mention.name,
      entityType: mention.entityType,
      status: resolution.status,
      reason: resolution.reason,
      payload: {
        evidence: mention.evidence,
        metadata: mention.metadata ?? {},
      },
      createdAt: now,
      updatedAt: now,
    });

    for (const candidate of resolution.candidates) {
      this.createReviewCandidate(task.id, candidate);
    }

    return task;
  }

  private createReviewCandidate(
    taskId: string,
    candidate: EntityResolutionCandidate,
  ): EntityResolutionCandidateRecord {
    return this.repository.createEntityResolutionCandidate({
      id: this.idFactory(),
      taskId,
      candidateEntityId: candidate.entityId,
      score: candidate.score,
      signals: candidate.signals,
      createdAt: this.clock(),
    });
  }
}
