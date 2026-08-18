import {
  type ConnectionClass,
  type EntityType,
  type RelationPredicate,
  type VerificationStatus,
  isPredicateCompatible,
} from "./ontology";

export type ClaimEvidenceDraft = {
  documentId: string;
  evidenceText: string;
};

export type ClaimDraft = {
  subjectType: EntityType;
  predicate: RelationPredicate;
  objectType: EntityType;
  connectionClass: ConnectionClass;
  verificationStatus: VerificationStatus;
  evidence: ClaimEvidenceDraft[];
};

export function hasEvidence(claim: Pick<ClaimDraft, "evidence">): boolean {
  return claim.evidence.some((evidence) => evidence.evidenceText.trim().length > 0);
}

export function canPublishClaim(claim: ClaimDraft): boolean {
  return (
    claim.verificationStatus === "VERIFIED" &&
    hasEvidence(claim) &&
    isPredicateCompatible(claim.predicate, claim.subjectType, claim.objectType)
  );
}

export function assertClaimCanBeVerified(claim: ClaimDraft): void {
  if (!hasEvidence(claim)) {
    throw new Error("A claim cannot be verified without evidence.");
  }

  if (!isPredicateCompatible(claim.predicate, claim.subjectType, claim.objectType)) {
    throw new Error("Claim predicate is incompatible with the subject or object entity type.");
  }
}

export function verifyClaim(claim: ClaimDraft): ClaimDraft {
  assertClaimCanBeVerified(claim);

  return {
    ...claim,
    verificationStatus: "VERIFIED",
  };
}
