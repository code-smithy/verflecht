import type { ClaimExtractionOutput } from "../llm/contracts";

import { isPredicateCompatible, type RelationPredicate, type VerificationStatus } from "./ontology";
import type { ResearchRepository } from "./repository";
import type { ClaimEvidenceRecord, ClaimRecord, EntityRecord, JsonRecord } from "./records";
import { ResearchDomainService } from "./services";

type ExtractedRelation = ClaimExtractionOutput["relations"][number];

export type ClaimExtractionInput = {
  documentId: string;
  relations: ClaimExtractionOutput["relations"];
  ambiguousEntityIds?: string[];
  sensitiveTopicTerms?: string[];
  createdBy?: string;
};

export type ClaimValidationOutcome = {
  verificationStatus: Extract<VerificationStatus, "PENDING_REVIEW" | "REJECTED">;
  evidenceScore: number;
  reasons: string[];
  warnings: string[];
  startChar?: number;
  endChar?: number;
  contextBefore?: string;
  contextAfter?: string;
};

export type ClaimExtractionCandidate = {
  relation: ExtractedRelation;
  validation: ClaimValidationOutcome;
  claim?: ClaimRecord;
  evidence?: ClaimEvidenceRecord;
};

export type ClaimExtractionResult = {
  candidates: ClaimExtractionCandidate[];
};

const DEFAULT_CONTEXT_CHARS = 180;
const DEFAULT_SENSITIVE_TOPIC_TERMS = [
  "russia",
  "russland",
  "russian",
  "waffen",
  "arms",
  "rustung",
  "ruestung",
  "extremismus",
  "extremism",
  "korruption",
  "corruption",
  "financial interest",
  "finanzielles interesse",
];

const relationCues: Record<RelationPredicate, string[]> = {
  MEMBER_OF: ["member of", "mitglied", "gehort zu", "gehört zu"],
  PRESIDENT_OF: ["president of", "prasident", "präsident", "vorsitz"],
  VICE_PRESIDENT_OF: ["vice president", "vizeprasident", "vizepräsident"],
  BOARD_MEMBER_OF: ["board member", "verwaltungsrat", "vorstandsmitglied"],
  EMPLOYED_BY: ["employed by", "arbeitet bei", "angestellt", "employee"],
  OWNS: ["owns", "owner", "besitzt", "eigentumer", "eigentümer"],
  SHAREHOLDER_OF: ["shareholder", "aktionar", "aktionär", "beteiligung"],
  HAS_MANDATE_AT: ["mandate", "mandat", "auftrag"],
  MEMBER_OF_COMMITTEE: ["committee member", "kommissionsmitglied", "mitglied der kommission"],
  PARTICIPATED_IN: [
    "participated in",
    "took part",
    "nahm teil",
    "teilgenommen",
    "besuchte",
    "teil",
  ],
  ORGANISED_BY: ["organized by", "organised by", "organisiert von", "veranstaltet von"],
  SPOKE_AT: ["spoke at", "sprach an", "sprach bei", "referierte"],
  MET_WITH: ["met with", "traf", "treffen mit", "meeting with"],
  REPRESENTED: ["represented", "vertrat", "representative", "vertreter"],
  FUNDED_BY: ["funded by", "finanziert von", "unterstutzt von", "unterstützt von"],
  SUPPORTED_INITIATIVE: [
    "supported initiative",
    "unterstutzte die initiative",
    "unterstützte die initiative",
  ],
  SIGNED_DECLARATION: ["signed", "unterzeichnete", "signatory"],
  HAS_BUSINESS_ACTIVITY_IN: ["business activity", "geschaftstatigkeit", "geschäftstätigkeit"],
  ISSUED_ACCESS_BADGE_TO: ["access badge", "zutrittsbadge", "badge"],
  ADVISOR_TO: ["advisor", "berater", "beriet"],
  FOUNDED: ["founded", "grundete", "gründete"],
  PARTNER_OF: ["partner", "partnership", "partnerschaft"],
};

const negationTerms = [
  "not",
  "never",
  "no longer",
  "kein",
  "keine",
  "nicht",
  "niemals",
  "nie",
  "n'est pas",
  "pas membre",
];

const contradictionTerms = [
  "contradicted",
  "denied",
  "disputed",
  "false",
  "no evidence",
  "widersprach",
  "bestritt",
  "dementierte",
  "widerlegt",
  "falsch",
];

const quoteTerms = [
  "said",
  "claimed",
  "according to",
  "alleged",
  "sagte",
  "behauptete",
  "laut",
  "gemass",
  "gemäß",
];

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/['']/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function containsTerm(text: string, terms: readonly string[]): boolean {
  const normalized = ` ${normalizeText(text)} `;

  return terms.some((term) => normalized.includes(` ${normalizeText(term)} `));
}

function findEvidenceSpan(
  documentText: string,
  evidenceText: string,
): { start: number; end: number } | undefined {
  const exactStart = documentText.indexOf(evidenceText);

  if (exactStart >= 0) {
    return { start: exactStart, end: exactStart + evidenceText.length };
  }

  const lowerDocument = documentText.toLowerCase();
  const lowerEvidence = evidenceText.toLowerCase();
  const caseInsensitiveStart = lowerDocument.indexOf(lowerEvidence);

  if (caseInsensitiveStart >= 0) {
    return { start: caseInsensitiveStart, end: caseInsensitiveStart + evidenceText.length };
  }

  return undefined;
}

function sentenceContext(documentText: string, start: number, end: number): string {
  const previousSentence = Math.max(
    documentText.lastIndexOf(".", start - 1),
    documentText.lastIndexOf("!", start - 1),
    documentText.lastIndexOf("?", start - 1),
  );
  const nextCandidates = [".", "!", "?"]
    .map((delimiter) => documentText.indexOf(delimiter, Math.max(start, end - 1)))
    .filter((index) => index >= 0);
  const nextSentence =
    nextCandidates.length > 0 ? Math.min(...nextCandidates) + 1 : documentText.length;

  return documentText.slice(previousSentence + 1, nextSentence).trim();
}

function nearbyContext(
  documentText: string,
  start: number,
  end: number,
): Pick<ClaimValidationOutcome, "contextBefore" | "contextAfter"> {
  return {
    contextBefore: documentText.slice(Math.max(0, start - DEFAULT_CONTEXT_CHARS), start).trim(),
    contextAfter: documentText
      .slice(end, Math.min(documentText.length, end + DEFAULT_CONTEXT_CHARS))
      .trim(),
  };
}

function entityNames(repository: ResearchRepository, entity: EntityRecord): string[] {
  return [
    entity.canonicalName,
    ...repository.listEntityAliasesByEntityId(entity.id).map((alias) => alias.alias),
  ];
}

function contextContainsEntity(
  repository: ResearchRepository,
  context: string,
  entity: EntityRecord,
): boolean {
  const normalizedContext = normalizeText(context);

  return entityNames(repository, entity).some((name) => {
    const normalizedName = normalizeText(name);

    return normalizedName.length > 0 && normalizedContext.includes(normalizedName);
  });
}

function hasExplicitRelationCue(predicate: RelationPredicate, context: string): boolean {
  return containsTerm(context, relationCues[predicate]);
}

function validationNotes(outcome: ClaimValidationOutcome): JsonRecord {
  return {
    phase: "phase-7",
    reasons: outcome.reasons,
    warnings: outcome.warnings,
  };
}

export class ClaimExtractionService {
  constructor(
    private readonly repository: ResearchRepository,
    private readonly domain: ResearchDomainService,
  ) {}

  createCandidates(input: ClaimExtractionInput): ClaimExtractionResult {
    const ambiguousEntityIds = new Set(input.ambiguousEntityIds ?? []);

    return {
      candidates: input.relations.map((relation) =>
        this.createCandidate(relation, input, ambiguousEntityIds),
      ),
    };
  }

  private createCandidate(
    relation: ExtractedRelation,
    input: ClaimExtractionInput,
    ambiguousEntityIds: Set<string>,
  ): ClaimExtractionCandidate {
    const validation = this.validateRelation(relation, input, ambiguousEntityIds);

    if (!relation.object_entity_id || validation.reasons.includes("object entity is missing")) {
      return { relation, validation };
    }

    if (
      validation.reasons.includes("subject entity is unknown") ||
      validation.reasons.includes("object entity is unknown")
    ) {
      return { relation, validation };
    }

    if (validation.reasons.includes("predicate is incompatible with entity types")) {
      return { relation, validation };
    }

    const claim = this.domain.createClaim({
      subjectEntityId: relation.subject_entity_id,
      predicate: relation.predicate,
      objectEntityId: relation.object_entity_id,
      literalValue: relation.literal_value as JsonRecord | undefined,
      connectionClass: relation.connection_class,
      validFrom: relation.valid_from,
      validTo: relation.valid_to,
      confidenceScore: relation.confidence,
      evidenceScore: validation.evidenceScore,
      validationNotes: validationNotes(validation),
      verificationStatus: validation.verificationStatus,
      createdBy: input.createdBy ?? "llm",
    });

    const evidence =
      validation.startChar !== undefined && validation.endChar !== undefined
        ? this.domain.addClaimEvidence({
            claimId: claim.id,
            documentId: input.documentId,
            evidenceText: relation.evidence_text,
            contextBefore: validation.contextBefore,
            contextAfter: validation.contextAfter,
            startChar: validation.startChar,
            endChar: validation.endChar,
          })
        : undefined;

    return { relation, validation, claim, evidence };
  }

  private validateRelation(
    relation: ExtractedRelation,
    input: ClaimExtractionInput,
    ambiguousEntityIds: Set<string>,
  ): ClaimValidationOutcome {
    const reasons: string[] = [];
    const warnings: string[] = [];
    let evidenceScore = 0;
    const document = this.repository.getDocument(input.documentId);
    const documentText = document?.extractedText ?? "";
    const source = document ? this.repository.getSource(document.sourceId) : undefined;
    const subject = this.repository.getEntity(relation.subject_entity_id);
    const object = relation.object_entity_id
      ? this.repository.getEntity(relation.object_entity_id)
      : undefined;

    if (!document) {
      reasons.push("document is unknown");
    }

    if (!documentText.trim()) {
      reasons.push("document has no extracted text");
    }

    if (!subject) {
      reasons.push("subject entity is unknown");
    }

    if (!relation.object_entity_id) {
      reasons.push("object entity is missing");
    }

    if (relation.object_entity_id && !object) {
      reasons.push("object entity is unknown");
    }

    if (
      subject &&
      object &&
      !isPredicateCompatible(relation.predicate, subject.entityType, object.entityType)
    ) {
      reasons.push("predicate is incompatible with entity types");
    }

    const span = documentText ? findEvidenceSpan(documentText, relation.evidence_text) : undefined;

    if (!span) {
      reasons.push("evidence text is not present in the document");
    }

    const context = span
      ? sentenceContext(documentText, span.start, span.end)
      : relation.evidence_text;

    if (hasExplicitRelationCue(relation.predicate, context)) {
      evidenceScore += 3;
    } else {
      reasons.push("evidence does not express the proposed relation");
      evidenceScore -= 3;
    }

    if (subject && !contextContainsEntity(this.repository, context, subject)) {
      reasons.push("subject entity is not explicit in the evidence context");
      evidenceScore -= 1;
    }

    if (object && !contextContainsEntity(this.repository, context, object)) {
      reasons.push("object entity is not explicit in the evidence context");
      evidenceScore -= 1;
    }

    if (
      subject &&
      object &&
      contextContainsEntity(this.repository, context, subject) &&
      contextContainsEntity(this.repository, context, object)
    ) {
      evidenceScore += 2;
    }

    if (source?.sourceQuality === "A" || source?.sourceQuality === "B") {
      evidenceScore += 2;
    }

    if (relation.valid_from || relation.valid_to || document?.publishedAt) {
      evidenceScore += 1;
    }

    if (relation.requires_review) {
      warnings.push("LLM marked the relation for review");
    }

    if (containsTerm(context, negationTerms)) {
      reasons.push("evidence contains likely negation");
      evidenceScore -= 4;
    }

    if (containsTerm(context, contradictionTerms)) {
      reasons.push("evidence appears contradicted or disputed");
      evidenceScore -= 4;
    }

    if (containsTerm(context, quoteTerms) || /["«»]/u.test(context)) {
      warnings.push("evidence appears to rely on a third-party quote or attribution");
      evidenceScore -= 3;
    }

    if (
      ambiguousEntityIds.has(relation.subject_entity_id) ||
      (relation.object_entity_id && ambiguousEntityIds.has(relation.object_entity_id))
    ) {
      warnings.push("entity resolution is ambiguous");
      evidenceScore -= 3;
    }

    if (
      containsTerm(context, [
        ...DEFAULT_SENSITIVE_TOPIC_TERMS,
        ...(input.sensitiveTopicTerms ?? []),
      ])
    ) {
      warnings.push("sensitive topic requires human verification");
    }

    const contextParts = span ? nearbyContext(documentText, span.start, span.end) : {};
    const verificationStatus = reasons.length > 0 ? "REJECTED" : "PENDING_REVIEW";

    return {
      verificationStatus,
      evidenceScore,
      reasons,
      warnings,
      startChar: span?.start,
      endChar: span?.end,
      ...contextParts,
    };
  }
}
