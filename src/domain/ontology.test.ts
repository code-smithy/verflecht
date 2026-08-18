import { describe, expect, it } from "vitest";

import {
  isConnectionClass,
  isEntityType,
  isPredicateCompatible,
  isRelationPredicate,
  isSourceType,
  isVerificationStatus,
} from "./ontology";

describe("controlled ontology", () => {
  it("accepts supported entity types, predicates, connection classes, statuses, and source types", () => {
    expect(isEntityType("PERSON")).toBe(true);
    expect(isRelationPredicate("MEMBER_OF")).toBe(true);
    expect(isConnectionClass("OFFICIAL")).toBe(true);
    expect(isVerificationStatus("PENDING_REVIEW")).toBe(true);
    expect(isSourceType("PARLIAMENT")).toBe(true);
  });

  it("rejects unknown ontology values", () => {
    expect(isEntityType("LOBBYIST")).toBe(false);
    expect(isRelationPredicate("KNOWS")).toBe(false);
    expect(isConnectionClass("RUMORED")).toBe(false);
    expect(isVerificationStatus("PUBLISHED")).toBe(false);
    expect(isSourceType("BLOG_POST")).toBe(false);
  });

  it("accepts compatible relationship shapes", () => {
    expect(isPredicateCompatible("MEMBER_OF", "PERSON", "POLITICAL_PARTY")).toBe(true);
    expect(isPredicateCompatible("ORGANISED_BY", "EVENT", "ORGANISATION")).toBe(true);
    expect(isPredicateCompatible("HAS_BUSINESS_ACTIVITY_IN", "COMPANY", "COUNTRY")).toBe(true);
  });

  it("rejects incompatible relationship shapes", () => {
    expect(isPredicateCompatible("MEMBER_OF", "LOCATION", "PERSON")).toBe(false);
    expect(isPredicateCompatible("ISSUED_ACCESS_BADGE_TO", "PERSON", "PARLIAMENT")).toBe(false);
    expect(isPredicateCompatible("SUPPORTED_INITIATIVE", "COUNTRY", "INITIATIVE")).toBe(false);
  });
});
