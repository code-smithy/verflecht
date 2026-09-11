import { z } from "zod";
import ontology from "../../data/ontology.json";

const text = z.string().trim().min(1);
const webUrl = z.url().refine((value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}, "Expected an HTTP(S) URL without credentials");

const sourceSchema = z.object({
  id: text,
  name: text,
  type: z.enum(ontology.source_types),
  url: webUrl,
});

export const graphSchema = z
  .object({
    schema_version: z.literal(1),
    nodes: z.array(z.object({ id: text, name: text, type: z.enum(ontology.entity_types) })),
    edges: z.array(
      z.object({
        id: text,
        subject_id: text,
        object_id: text,
        predicate: z.enum(ontology.predicates),
        connection_class: z.enum(ontology.connection_classes),
        valid_from: z.iso.date().nullable(),
        valid_to: z.iso.date().nullable(),
        evidence: z
          .array(
            z.object({
              text,
              document: z.object({
                id: text,
                title: text,
                url: webUrl,
                source_id: text,
                content_hash: z.string().regex(/^[a-f0-9]{64}$/),
              }),
              source: sourceSchema,
            }),
          )
          .min(1),
      }),
    ),
  })
  .superRefine((graph, context) => {
    const ids = new Set(graph.nodes.map((node) => node.id));
    if (
      ids.size !== graph.nodes.length ||
      new Set(graph.edges.map((edge) => edge.id)).size !== graph.edges.length
    ) {
      context.addIssue({ code: "custom", message: "Duplicate graph IDs" });
    }
    for (const edge of graph.edges) {
      if (!ids.has(edge.subject_id) || !ids.has(edge.object_id)) {
        context.addIssue({ code: "custom", message: "Relationship references an unknown entity" });
      }
      if (edge.evidence.some((item) => item.document.source_id !== item.source.id)) {
        context.addIssue({
          code: "custom",
          message: "Evidence source does not match its document",
        });
      }
    }
  });

export type Graph = z.infer<typeof graphSchema>;

const partPath = z.string().regex(/^graph\.parts\/[a-f0-9]{64}\.json$/);
const manifestSchema = z
  .object({
    schema_version: z.literal(1),
    storage: z.literal("json-parts-v1"),
    parts: z.object({ nodes: z.array(partPath), edges: z.array(partPath) }).strict(),
  })
  .strict();

export async function loadGraph(signal?: AbortSignal): Promise<Graph> {
  const basePath = process.env.NEXT_PUBLIC_SITE_BASE_PATH ?? "";
  const read = async (path: string): Promise<unknown> => {
    const response = await fetch(`${basePath}/data/${path}`, { cache: "no-store", signal });
    if (!response.ok) throw new Error("Research data could not be loaded. Please try again.");
    return response.json();
  };
  const data = await read("graph.json");
  if (typeof data !== "object" || data === null || !("storage" in data)) {
    return graphSchema.parse(data);
  }
  const manifest = manifestSchema.parse(data);
  const assembled: { schema_version: 1; nodes: unknown[]; edges: unknown[] } = {
    schema_version: 1,
    nodes: [],
    edges: [],
  };
  // Bound concurrent downloads and retain validation across all part boundaries.
  for (const key of ["nodes", "edges"] as const) {
    for (const path of manifest.parts[key]) {
      const rows = z.array(z.unknown()).parse(await read(path));
      for (const row of rows) assembled[key].push(row);
    }
  }
  return graphSchema.parse(assembled);
}
