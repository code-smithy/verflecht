import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { graphSchema, loadGraph } from "../src/lib/graph";
import graph from "./fixtures/graph.json";

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

  it("validates the published dataset through the production loader", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => JSON.parse(readFileSync(resolve("public", url.slice(1)), "utf-8")),
      })),
    );
    await expect(loadGraph()).resolves.toHaveProperty("schema_version", 1);
  });

  it("accepts parliamentary affairs with distinct authorship and co-signature links", () => {
    for (const predicate of ["AUTHORED", "CO_SIGNED"]) {
      const affairGraph = {
        ...graph,
        nodes: graph.nodes.map((node) =>
          node.id === graph.edges[0].object_id ? { ...node, type: "PARLIAMENTARY_AFFAIR" } : node,
        ),
        edges: [{ ...graph.edges[0], predicate }],
      };
      expect(graphSchema.parse(affairGraph).edges[0].predicate).toBe(predicate);
    }
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

  it("assembles parts with cross-part references under the project path", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_BASE_PATH", "/verflecht");
    const nodes = `graph.parts/${"a".repeat(64)}.json`;
    const edges = `graph.parts/${"b".repeat(64)}.json`;
    const manifest = {
      schema_version: 1,
      storage: "json-parts-v1",
      parts: { nodes: [nodes], edges: [edges] },
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => manifest })
      .mockResolvedValueOnce({ ok: true, json: async () => graph.nodes })
      .mockResolvedValueOnce({ ok: true, json: async () => graph.edges });
    vi.stubGlobal("fetch", request);
    const signal = new AbortController().signal;
    expect(await loadGraph(signal)).toEqual(graph);
    expect(request).toHaveBeenLastCalledWith(`/verflecht/data/${edges}`, {
      cache: "no-store",
      signal,
    });
  });

  it("rejects missing parts, unsafe paths, and duplicate IDs across parts", async () => {
    const part = `graph.parts/${"a".repeat(64)}.json`;
    const manifest = {
      schema_version: 1,
      storage: "json-parts-v1",
      parts: { nodes: [part], edges: [] },
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => manifest })
        .mockResolvedValueOnce({ ok: false }),
    );
    await expect(loadGraph()).rejects.toThrow("could not be loaded");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ...manifest,
          parts: { nodes: ["../research.json"], edges: [] },
        }),
      }),
    );
    await expect(loadGraph()).rejects.toThrow();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ ...manifest, parts: { nodes: [part, part], edges: [] } }),
        })
        .mockResolvedValue({ ok: true, json: async () => graph.nodes }),
    );
    await expect(loadGraph()).rejects.toThrow("Duplicate graph IDs");
  });
});
