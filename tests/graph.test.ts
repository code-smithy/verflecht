import { afterEach, describe, expect, it, vi } from "vitest";
import { graphSchema, loadGraph } from "../src/lib/graph";
import graph from "./fixtures/graph.json";
import published from "../public/data/graph.json";

const empty = {
  schema_version: 1,
  nodes: [],
  edges: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Python export contract", () => {
  it("accepts the shared Python fixture and an empty dataset", () => {
    expect(graphSchema.parse(graph).edges).toHaveLength(1);
    expect(graphSchema.parse(empty).edges).toHaveLength(0);
  });

  it("validates the published dataset", () => {
    expect(graphSchema.safeParse(published).success).toBe(true);
  });

  it("rejects broken references, duplicate IDs, missing evidence, and unsafe URLs", () => {
    const invalid = [
      { ...graph, nodes: [] },
      { ...graph, nodes: [...graph.nodes, graph.nodes[0]] },
      { ...graph, edges: [...graph.edges, graph.edges[0]] },
      { ...graph, edges: [{ ...graph.edges[0], evidence: [] }] },
      { ...graph, edges: [{ ...graph.edges[0], predicate: "MADE_UP" }] },
      {
        ...graph,
        edges: [
          {
            ...graph.edges[0],
            evidence: [
              {
                ...graph.edges[0].evidence[0],
                source: { ...graph.edges[0].evidence[0].source, url: "javascript:alert(1)" },
              },
            ],
          },
        ],
      },
      {
        ...graph,
        edges: [
          {
            ...graph.edges[0],
            evidence: [
              {
                ...graph.edges[0].evidence[0],
                source: { ...graph.edges[0].evidence[0].source, id: "wrong-source" },
              },
            ],
          },
        ],
      },
    ];
    for (const data of invalid) expect(graphSchema.safeParse(data).success).toBe(false);
  });

  it("loads generated JSON without cached results and supports cancellation", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => graph });
    vi.stubGlobal("fetch", request);
    const controller = new AbortController();
    expect(await loadGraph(controller.signal)).toEqual(graph);
    expect(request).toHaveBeenCalledWith("/data/graph.json", {
      cache: "no-store",
      signal: controller.signal,
    });
  });

  it("reports missing and invalid exports instead of treating them as an empty graph", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(loadGraph()).rejects.toThrow("could not be loaded");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
    await expect(loadGraph()).rejects.toThrow();
  });

  it("loads research under the GitHub Pages project path", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_BASE_PATH", "/verflecht");
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => graph });
    vi.stubGlobal("fetch", request);
    expect(await loadGraph()).toEqual(graph);
    expect(request).toHaveBeenCalledWith("/verflecht/data/graph.json", {
      cache: "no-store",
      signal: undefined,
    });
  });
});
