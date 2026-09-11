import type { Graph } from "./graph";

export type Filters = { query: string; predicate: string; date: string };
export function filterNetwork(graph: Graph, filters: Filters): Graph {
  const query = filters.query.trim().toLowerCase();
  const matches = new Set(
    graph.nodes.filter((n) => n.name.toLowerCase().includes(query)).map((n) => n.id),
  );
  const edges = graph.edges.filter(
    (e) =>
      (!query || matches.has(e.subject_id) || matches.has(e.object_id)) &&
      (!filters.predicate || e.predicate === filters.predicate) &&
      (!filters.date ||
        ((!e.valid_from || e.valid_from <= filters.date) &&
          (!e.valid_to || e.valid_to >= filters.date))),
  );
  const ids = new Set(edges.flatMap((e) => [e.subject_id, e.object_id]));
  return { schema_version: 1, nodes: graph.nodes.filter((n) => ids.has(n.id)), edges };
}

export function networkWindow(graph: Graph, limit = 80): Graph {
  const degree = new Map<string, number>();
  for (const e of graph.edges)
    for (const id of [e.subject_id, e.object_id]) degree.set(id, (degree.get(id) ?? 0) + 1);
  const nodes = [...graph.nodes]
    .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) || a.id.localeCompare(b.id))
    .slice(0, limit);
  const ids = new Set(nodes.map((n) => n.id));
  return {
    schema_version: 1,
    nodes,
    edges: graph.edges.filter((e) => ids.has(e.subject_id) && ids.has(e.object_id)).slice(0, 300),
  };
}
