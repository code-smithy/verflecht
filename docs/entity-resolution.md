# Entity Resolution

Phase 6 introduces deterministic entity candidate matching under
`src/domain/entity-resolution.ts`.

## Scope

The resolver accepts extracted entity mentions and compares them with known
entities of the same type. It scores candidates using:

- exact canonical name
- exact aliases
- surname or partial-name fallback
- party, canton, position, organisation, country, time-period, and
  co-mentioned-entity metadata

Thresholds are configurable:

- `autoResolveThreshold`, default `0.82`
- `candidateThreshold`, default `0.2`
- `ambiguityDelta`, default `0.08`

## Safety Rules

The resolver returns candidates and can select a candidate only when the top
match is above the automatic threshold and is not ambiguous.

Manual review is required when:

- no candidate reaches the candidate threshold
- the best candidate is below the automatic threshold
- multiple candidates are too close together
- ambiguous people share surname-only evidence or the same apparent identity

This phase does not merge entities. It only returns a selected entity id for
clear matches and creates review tasks for uncertain matches.

## Persistence

`supabase/migrations/202608180003_phase_6_entity_resolution.sql` adds:

- `entity_resolution_tasks`
- `entity_resolution_candidates`
- `entity_resolution_status`

Public users cannot read these tables. Internal roles can read them,
researchers can create proposed tasks and candidates, and reviewers can update
tasks after manual review.

## Tests

`src/domain/entity-resolution.test.ts` covers the Phase 6 required cases:

- exact alias match
- ambiguous surname match
- same-name different-canton case
- below-threshold manual review case
- no automatic merge for ambiguous people
