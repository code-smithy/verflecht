import { describe, expect, it } from "vitest";

import { assertClaimCanBeVerified, canPublishClaim, verifyClaim, type ClaimDraft } from "./claims";

const baseClaim = {
  subjectType: "PERSON",
  predicate: "MEMBER_OF",
  objectType: "POLITICAL_PARTY",
  connectionClass: "DIRECT",
  verificationStatus: "PENDING_REVIEW",
  evidence: [
    { documentId: "document-1", evidenceText: "Jane Example is a member of Example Party." },
  ],
} satisfies ClaimDraft;

describe("claim verification rules", () => {
  it("refuses to verify a claim without evidence", () => {
    expect(() =>
      assertClaimCanBeVerified({
        ...baseClaim,
        evidence: [],
      }),
    ).toThrow("without evidence");
  });

  it("refuses to verify incompatible relationship shapes", () => {
    expect(() =>
      assertClaimCanBeVerified({
        ...baseClaim,
        subjectType: "LOCATION",
      }),
    ).toThrow("incompatible");
  });

  it("marks a source-backed compatible claim as verified", () => {
    expect(verifyClaim(baseClaim)).toMatchObject({
      verificationStatus: "VERIFIED",
    });
  });

  it("publishes only verified source-backed compatible claims", () => {
    expect(canPublishClaim({ ...baseClaim, verificationStatus: "VERIFIED" })).toBe(true);
    expect(canPublishClaim(baseClaim)).toBe(false);
    expect(canPublishClaim({ ...baseClaim, verificationStatus: "VERIFIED", evidence: [] })).toBe(
      false,
    );
    expect(
      canPublishClaim({ ...baseClaim, verificationStatus: "VERIFIED", subjectType: "LOCATION" }),
    ).toBe(false);
  });
});
