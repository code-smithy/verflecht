import type { Graph } from "./graph";

export type Filters = { query: string; predicate: string; date: string; includeInactive: boolean };

const isActiveOn = (edge: Graph["edges"][number], date: string) =>
  (!edge.valid_from || edge.valid_from <= date) && (!edge.valid_to || edge.valid_to >= date);

export function filterNetwork(
  graph: Graph,
  filters: Filters,
  today = new Date().toISOString().slice(0, 10),
): Graph {
  const query = filters.query.trim().toLowerCase();
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const activeDate = filters.date || today;
  const activePeople = new Set(
    graph.edges
      .filter((edge) => isActiveOn(edge, activeDate))
      .flatMap((edge) => [edge.subject_id, edge.object_id])
      .filter((id) => nodeById.get(id)?.type === "PERSON"),
  );
  const matches = new Set(
    graph.nodes.filter((n) => n.name.toLowerCase().includes(query)).map((n) => n.id),
  );
  const edges = graph.edges.filter(
    (e) =>
      (filters.includeInactive ||
        [e.subject_id, e.object_id].every(
          (id) => nodeById.get(id)?.type !== "PERSON" || activePeople.has(id),
        )) &&
      (!query || matches.has(e.subject_id) || matches.has(e.object_id)) &&
      (!filters.predicate || e.predicate === filters.predicate) &&
      (!filters.date || isActiveOn(e, filters.date)),
  );
  const ids = new Set(edges.flatMap((e) => [e.subject_id, e.object_id]));
  return { schema_version: 1, nodes: graph.nodes.filter((n) => ids.has(n.id)), edges };
}

export function networkWindow(graph: Graph, limit = 360, edgeLimit = 4500): Graph {
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
    edges: graph.edges
      .filter((e) => ids.has(e.subject_id) && ids.has(e.object_id))
      .sort(
        (a, b) =>
          (degree.get(b.subject_id) ?? 0) +
            (degree.get(b.object_id) ?? 0) -
            (degree.get(a.subject_id) ?? 0) -
            (degree.get(a.object_id) ?? 0) || a.id.localeCompare(b.id),
      )
      .slice(0, edgeLimit),
  };
}

export function connectedWithin(graph: Graph, startId: string, maxDistance: number): Set<string> {
  if (!graph.nodes.some((node) => node.id === startId)) return new Set();
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    adjacency.set(edge.subject_id, [...(adjacency.get(edge.subject_id) ?? []), edge.object_id]);
    adjacency.set(edge.object_id, [...(adjacency.get(edge.object_id) ?? []), edge.subject_id]);
  }
  const seen = new Set([startId]);
  let frontier = [startId];
  for (let distance = 0; distance < Math.max(0, Math.floor(maxDistance)); distance += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbour of adjacency.get(id) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        next.push(neighbour);
      }
    }
    if (!next.length) break;
    frontier = next;
  }
  return seen;
}
