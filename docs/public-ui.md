# Public UI

Phase 10 replaces the internal review mock on the root page with the public research interface.

The page loads the sanitized public graph projection through `PublicGraphService` and renders only
edges that include source-backed evidence. If the Supabase-backed repository is not configured, the
page renders an empty public state instead of exposing internal data or failing open.

The public interface includes:

- an SVG network view with zoom, pan, draggable nodes, selection, neighbor highlighting, clusters,
  and relationship-specific line styles;
- search and filters for entity type, relation predicate, connection class, historical visibility,
  and source quality;
- person search/detail summaries derived from visible verified relationships;
- a timeline view that marks historical relationships separately from current relationships;
- a sortable research table with person, relation, target, class, validity, and source columns;
- source and evidence details in the side panel for every selected relationship.

The UI performs a defensive client-side projection before display. Edges without a subject, object,
evidence text, source name, or document URL are removed from the display model.
