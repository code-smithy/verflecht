# Claim Extraction and Evidence Validation

Phase 7 introduces deterministic claim-candidate validation under
`src/domain/claim-extraction.ts`.

## Scope

The service accepts already schema-validated LLM relation output and creates
claim candidates only after checking the local repository context:

- the source document exists and has extracted text
- the evidence text appears in the document
- subject and object entities exist
- subject and object are explicit in the evidence sentence
- the predicate is compatible with the entity types
- relation wording is present for the proposed predicate
- likely negation and contradiction language is detected
- ambiguous entity resolutions and third-party attributions lower confidence

Extraction never verifies a claim. Supported candidates are persisted as
`PENDING_REVIEW`; hard validation failures are persisted as `REJECTED` when the
claim shape is valid enough to store. Invalid shapes such as unknown entities or
incompatible predicates are returned as rejected validation results without
creating claim records.

## Evidence Score

The LLM confidence remains stored as `confidenceScore`. Phase 7 adds a separate
deterministic `evidenceScore` and compact `validationNotes` metadata on claims.
The score rewards explicit relation wording, subject/object presence, high
source quality, and dates. It penalizes missing context, negation,
contradiction, quote attribution, indirect wording, and ambiguous entity
resolution.

Sensitive topic terms are always marked in validation warnings so reviewers can
apply human verification before any public graph exposure.

## Tests

`src/domain/claim-extraction.test.ts` covers the required Phase 7 fixtures:

- positive relationship
- negated relationship
- historical relationship
- official meeting
- event participation
- co-mention without relationship
- third-party quote
- contradicted claim
- ambiguous person
- multiple people with the same organization
- missing evidence text in the document
