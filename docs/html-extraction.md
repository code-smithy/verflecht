# HTML Extraction

Phase 4 introduces deterministic HTML extraction under `src/ingestion/html-extraction.ts`.

## Boundaries

- `extractHtmlDocument` extracts title, author, published date, publisher, description, body text, and language.
- Metadata precedence is JSON-LD, Schema.org metadata, OpenGraph/Twitter metadata, plain HTML metadata, then visible content.
- Visible text extraction removes scripts, styles, navigation, headers, footers, SVGs, comments, and noscript content before normalizing whitespace.
- The domain service writes extraction output back onto the existing document record with `updateDocumentExtraction`; extracted descriptions are stored in document metadata because the Phase 1 `documents` table has no dedicated description column.

## Status Mapping

- `SUCCESS` means a title and visible body text were extracted.
- `PARTIAL` means visible body text exists, but core metadata such as title is missing.
- `METADATA_ONLY` means metadata was found, but no visible body text was extracted.
- `FAILED` means neither usable metadata nor visible body text was found.

## Test Coverage

Phase 4 tests cover:

- JSON-LD metadata precedence
- OpenGraph fallback metadata
- visible-content fallback extraction
- metadata-only and failed status cases
- document-record persistence through the domain service
