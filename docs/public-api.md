# Public API

Phase 9 exposes verified, source-backed graph data through server-side Next.js route handlers.

## Routes

### `GET /api/graph`

Returns:

```json
{
  "nodes": [],
  "edges": []
}
```

Supported query parameters:

- `entity_id`
- `entity_type`
- `predicate`
- `connection_class`
- `topic`
- `person`
- `organization` or `organisation`
- `date_from`
- `date_to`
- `include_historical`

Invalid enum values, invalid booleans, malformed dates, and inverted date ranges return `400`.

### `GET /api/entities/:id`

Returns a public entity detail projection containing:

- entity
- public aliases
- verified claims
- connected entities
- connected events
- sources
- timeline

The endpoint returns `404` if the entity has no verified, source-backed public claim.

### `GET /api/claims/:id`

Returns one verified claim with:

- subject
- relation
- object
- connection class
- validity dates
- verification status
- evidence
- source and document metadata

The endpoint returns `404` for pending, rejected, disputed, outdated, literal-only, or evidence-free claims.

## Privacy Boundary

Public API responses are projected through `PublicGraphService`. They exclude:

- audit log records
- review queue records
- `createdBy`, `reviewedBy`, and `reviewedAt`
- raw document storage paths
- extracted full text
- source metadata
- entity metadata
- LLM prompts and run internals
- crawler configuration and credentials

Every public edge includes at least one evidence record that resolves to both a document and a source.

## Runtime

The route handlers load Supabase rows on the server and then apply the same public projection used by unit tests.
They require:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

`NEXT_PUBLIC_SUPABASE_ANON_KEY` can be present for browser-safe client code, but the public API uses the server-side key so it can read source and document metadata before returning only sanitized fields.
