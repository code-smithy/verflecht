export const entityTypes = [
  "PERSON",
  "ORGANISATION",
  "COMPANY",
  "POLITICAL_PARTY",
  "COMMITTEE",
  "PARLIAMENT",
  "GOVERNMENT_BODY",
  "EVENT",
  "INITIATIVE",
  "ASSOCIATION",
  "MEDIA_OUTLET",
  "LOCATION",
  "COUNTRY",
  "OTHER",
] as const;

export const relationPredicates = [
  "MEMBER_OF",
  "PRESIDENT_OF",
  "VICE_PRESIDENT_OF",
  "BOARD_MEMBER_OF",
  "EMPLOYED_BY",
  "OWNS",
  "SHAREHOLDER_OF",
  "HAS_MANDATE_AT",
  "MEMBER_OF_COMMITTEE",
  "PARTICIPATED_IN",
  "ORGANISED_BY",
  "SPOKE_AT",
  "MET_WITH",
  "REPRESENTED",
  "FUNDED_BY",
  "SUPPORTED_INITIATIVE",
  "SIGNED_DECLARATION",
  "HAS_BUSINESS_ACTIVITY_IN",
  "ISSUED_ACCESS_BADGE_TO",
  "ADVISOR_TO",
  "FOUNDED",
  "PARTNER_OF",
] as const;

export const connectionClasses = ["DIRECT", "INDIRECT", "OFFICIAL", "HISTORICAL"] as const;

export const verificationStatuses = [
  "DETECTED",
  "PENDING_REVIEW",
  "VERIFIED",
  "REJECTED",
  "DISPUTED",
  "OUTDATED",
] as const;

export const sourceTypes = [
  "OFFICIAL_REGISTER",
  "PARLIAMENT",
  "GOVERNMENT",
  "COMPANY_REGISTER",
  "COMPANY_WEBSITE",
  "ORGANISATION_WEBSITE",
  "NEWS_ARTICLE",
  "PRESS_RELEASE",
  "EVENT_PROGRAM",
  "PDF",
  "SOCIAL_MEDIA",
  "MANUAL_RESEARCH",
  "OTHER",
] as const;

export const accessStatuses = [
  "PUBLIC",
  "PAYWALLED",
  "BLOCKED",
  "LOGIN_REQUIRED",
  "REMOVED",
  "UNKNOWN",
] as const;

export const extractionStatuses = [
  "PENDING",
  "SUCCESS",
  "PARTIAL",
  "METADATA_ONLY",
  "FAILED",
] as const;

export const sourceQualityClasses = ["A", "B", "C", "D", "E", "X"] as const;

export const userRoles = ["ADMIN", "RESEARCHER", "REVIEWER", "PUBLIC"] as const;

export type EntityType = (typeof entityTypes)[number];
export type RelationPredicate = (typeof relationPredicates)[number];
export type ConnectionClass = (typeof connectionClasses)[number];
export type VerificationStatus = (typeof verificationStatuses)[number];
export type SourceType = (typeof sourceTypes)[number];
export type AccessStatus = (typeof accessStatuses)[number];
export type ExtractionStatus = (typeof extractionStatuses)[number];
export type SourceQualityClass = (typeof sourceQualityClasses)[number];
export type UserRole = (typeof userRoles)[number];

const entityTypeSet = new Set<string>(entityTypes);
const relationPredicateSet = new Set<string>(relationPredicates);
const connectionClassSet = new Set<string>(connectionClasses);
const verificationStatusSet = new Set<string>(verificationStatuses);
const sourceTypeSet = new Set<string>(sourceTypes);

const organisationLikeTypes = [
  "ORGANISATION",
  "COMPANY",
  "POLITICAL_PARTY",
  "COMMITTEE",
  "PARLIAMENT",
  "GOVERNMENT_BODY",
  "ASSOCIATION",
  "MEDIA_OUTLET",
] satisfies EntityType[];

type PredicateCompatibility = {
  subjects: readonly EntityType[];
  objects: readonly EntityType[];
};

export const predicateCompatibility = {
  MEMBER_OF: {
    subjects: ["PERSON", "ORGANISATION", "COMPANY"],
    objects: organisationLikeTypes,
  },
  PRESIDENT_OF: { subjects: ["PERSON"], objects: organisationLikeTypes },
  VICE_PRESIDENT_OF: { subjects: ["PERSON"], objects: organisationLikeTypes },
  BOARD_MEMBER_OF: { subjects: ["PERSON"], objects: ["COMPANY", "ORGANISATION", "ASSOCIATION"] },
  EMPLOYED_BY: { subjects: ["PERSON"], objects: organisationLikeTypes },
  OWNS: { subjects: ["PERSON", "COMPANY", "ORGANISATION"], objects: ["COMPANY", "ORGANISATION"] },
  SHAREHOLDER_OF: { subjects: ["PERSON", "COMPANY", "ORGANISATION"], objects: ["COMPANY"] },
  HAS_MANDATE_AT: {
    subjects: ["PERSON", "COMPANY", "ORGANISATION"],
    objects: organisationLikeTypes,
  },
  MEMBER_OF_COMMITTEE: { subjects: ["PERSON"], objects: ["COMMITTEE"] },
  PARTICIPATED_IN: { subjects: ["PERSON", ...organisationLikeTypes], objects: ["EVENT"] },
  ORGANISED_BY: { subjects: ["EVENT"], objects: ["PERSON", ...organisationLikeTypes] },
  SPOKE_AT: { subjects: ["PERSON"], objects: ["EVENT"] },
  MET_WITH: {
    subjects: ["PERSON", "ORGANISATION", "COMPANY", "POLITICAL_PARTY", "GOVERNMENT_BODY"],
    objects: ["PERSON", "ORGANISATION", "COMPANY", "POLITICAL_PARTY", "GOVERNMENT_BODY"],
  },
  REPRESENTED: {
    subjects: ["PERSON", "ORGANISATION", "COMPANY", "POLITICAL_PARTY"],
    objects: ["PERSON", ...organisationLikeTypes],
  },
  FUNDED_BY: {
    subjects: [
      "PERSON",
      "ORGANISATION",
      "COMPANY",
      "POLITICAL_PARTY",
      "EVENT",
      "INITIATIVE",
      "ASSOCIATION",
    ],
    objects: ["PERSON", "ORGANISATION", "COMPANY", "POLITICAL_PARTY", "ASSOCIATION"],
  },
  SUPPORTED_INITIATIVE: {
    subjects: ["PERSON", "ORGANISATION", "COMPANY", "POLITICAL_PARTY", "ASSOCIATION"],
    objects: ["INITIATIVE"],
  },
  SIGNED_DECLARATION: {
    subjects: ["PERSON", "ORGANISATION", "COMPANY", "POLITICAL_PARTY", "ASSOCIATION"],
    objects: ["OTHER", "INITIATIVE"],
  },
  HAS_BUSINESS_ACTIVITY_IN: {
    subjects: ["PERSON", "ORGANISATION", "COMPANY", "ASSOCIATION"],
    objects: ["LOCATION", "COUNTRY"],
  },
  ISSUED_ACCESS_BADGE_TO: { subjects: ["PARLIAMENT", "GOVERNMENT_BODY"], objects: ["PERSON"] },
  ADVISOR_TO: {
    subjects: ["PERSON", "ORGANISATION", "COMPANY"],
    objects: ["PERSON", "ORGANISATION", "COMPANY", "POLITICAL_PARTY", "GOVERNMENT_BODY"],
  },
  FOUNDED: {
    subjects: ["PERSON", "ORGANISATION", "COMPANY"],
    objects: ["ORGANISATION", "COMPANY", "POLITICAL_PARTY", "ASSOCIATION", "MEDIA_OUTLET"],
  },
  PARTNER_OF: {
    subjects: ["PERSON", "ORGANISATION", "COMPANY", "POLITICAL_PARTY", "ASSOCIATION"],
    objects: ["PERSON", "ORGANISATION", "COMPANY", "POLITICAL_PARTY", "ASSOCIATION"],
  },
} satisfies Record<RelationPredicate, PredicateCompatibility>;

export function isEntityType(value: string): value is EntityType {
  return entityTypeSet.has(value);
}

export function isRelationPredicate(value: string): value is RelationPredicate {
  return relationPredicateSet.has(value);
}

export function isConnectionClass(value: string): value is ConnectionClass {
  return connectionClassSet.has(value);
}

export function isVerificationStatus(value: string): value is VerificationStatus {
  return verificationStatusSet.has(value);
}

export function isSourceType(value: string): value is SourceType {
  return sourceTypeSet.has(value);
}

export function isPredicateCompatible(
  predicate: RelationPredicate,
  subjectType: EntityType,
  objectType: EntityType,
): boolean {
  const compatibility = predicateCompatibility[predicate];
  const subjects: readonly EntityType[] = compatibility.subjects;
  const objects: readonly EntityType[] = compatibility.objects;

  return subjects.includes(subjectType) && objects.includes(objectType);
}
