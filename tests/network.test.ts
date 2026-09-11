import { describe, expect, it } from "vitest";
import fixture from "./fixtures/graph.json";
import { graphSchema } from "../src/lib/graph";
import { filterNetwork, networkWindow } from "../src/lib/network";

const graph = graphSchema.parse(fixture);
describe("network explorer", () => {
  it("keeps neighbours and evidence when searching a name", () => {
    const result = filterNetwork(graph, {
      query: graph.nodes[0].name.toUpperCase(),
      predicate: "",
      date: "",
    });
    expect(result.edges).toEqual(graph.edges);
    expect(result.nodes).toEqual(graph.nodes);
  });
  it("returns no results for an unknown name", () => {
    expect(filterNetwork(graph, { query: "no match", predicate: "", date: "" }).edges).toEqual([]);
  });
  it("filters dates inclusively and relationship types exactly", () => {
    const dated = {
      ...graph,
      edges: [{ ...graph.edges[0], valid_from: "2020-01-01", valid_to: "2021-01-01" }],
    };
    expect(
      filterNetwork(dated, { query: "", predicate: "", date: "2021-01-01" }).edges,
    ).toHaveLength(1);
    expect(
      filterNetwork(dated, { query: "", predicate: "", date: "2022-01-01" }).edges,
    ).toHaveLength(0);
    expect(filterNetwork(dated, { query: "", predicate: "unknown", date: "" }).edges).toHaveLength(
      0,
    );
  });
  it("bounds the visual graph without creating dangling edges or changing input", () => {
    const limited = networkWindow(graph, 1);
    expect(limited.nodes).toHaveLength(1);
    expect(limited.edges).toHaveLength(0);
    expect(graph.edges).toHaveLength(1);
  });
});
