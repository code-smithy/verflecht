import { describe, expect, it } from "vitest";
import fixture from "./fixtures/graph.json";
import { graphSchema } from "../src/lib/graph";
import {
  connectedWithin,
  describeEntity,
  filterNetwork,
  networkWindow,
  relationshipEndedBefore,
} from "../src/lib/network";

const graph = graphSchema.parse(fixture);
describe("network explorer", () => {
  it("keeps neighbours and evidence when searching a name", () => {
    const result = filterNetwork(graph, {
      query: graph.nodes[0].name.toUpperCase(),
      predicate: "",
      date: "",
      includeInactive: false,
      declaredInterestsOnly: false,
    });
    expect(result.edges).toEqual(graph.edges);
    expect(result.nodes).toEqual(graph.nodes);
  });
  it("returns no results for an unknown name", () => {
    expect(
      filterNetwork(graph, {
        query: "no match",
        predicate: "",
        date: "",
        includeInactive: false,
        declaredInterestsOnly: false,
      }),
    ).toEqual({ schema_version: 1, nodes: [], edges: [] });
  });
  it("filters dates inclusively and relationship types exactly", () => {
    const dated = {
      ...graph,
      edges: [{ ...graph.edges[0], valid_from: "2020-01-01", valid_to: "2021-01-01" }],
    };
    expect(
      filterNetwork(dated, {
        query: "",
        predicate: "",
        date: "2021-01-01",
        includeInactive: false,
        declaredInterestsOnly: false,
      }).edges,
    ).toHaveLength(1);
    expect(
      filterNetwork(dated, {
        query: "",
        predicate: "",
        date: "2022-01-01",
        includeInactive: false,
        declaredInterestsOnly: false,
      }).edges,
    ).toHaveLength(0);
    expect(
      filterNetwork(dated, {
        query: "",
        predicate: "unknown",
        date: "",
        includeInactive: true,
        declaredInterestsOnly: false,
      }).edges,
    ).toHaveLength(0);
  });
  it("hides people without a current relationship unless requested", () => {
    const dated = {
      ...graph,
      edges: [{ ...graph.edges[0], valid_from: "2020-01-01", valid_to: "2021-01-01" }],
    };
    expect(
      filterNetwork(
        dated,
        {
          query: "",
          predicate: "",
          date: "",
          includeInactive: false,
          declaredInterestsOnly: false,
        },
        "2026-01-01",
      ).nodes,
    ).toHaveLength(0);
    expect(
      filterNetwork(
        dated,
        {
          query: "",
          predicate: "",
          date: "",
          includeInactive: true,
          declaredInterestsOnly: false,
        },
        "2026-01-01",
      ).nodes,
    ).toHaveLength(2);
  });
  it("exposes official declared interests as a dedicated filter", () => {
    const interest = {
      ...graph.edges[0],
      id: "parliament:concern:example",
      evidence: graph.edges[0].evidence.map((item) => ({
        ...item,
        document: { ...item.document, id: "parliament:concerns-document:1:example" },
      })),
    };
    const mixed = { ...graph, edges: [graph.edges[0], interest] };
    const result = filterNetwork(mixed, {
      query: "",
      predicate: "",
      date: "",
      includeInactive: true,
      declaredInterestsOnly: true,
    });
    expect(result.edges).toEqual([interest]);
    expect(result.nodes).toEqual(graph.nodes);
  });
  it("bounds the visual graph without creating dangling edges or changing input", () => {
    const limited = networkWindow(graph, 1);
    expect(limited.nodes).toHaveLength(1);
    expect(limited.edges).toHaveLength(0);
    expect(graph.edges).toHaveLength(1);
  });
  it("finds entities within a configurable number of connections", () => {
    const third = { ...graph.nodes[0], id: "organisation-2", name: "Second Organisation" };
    const chain = graphSchema.parse({
      ...graph,
      nodes: [...graph.nodes, third],
      edges: [
        ...graph.edges,
        {
          ...graph.edges[0],
          id: "claim-2",
          subject_id: graph.nodes[0].id,
          object_id: third.id,
        },
      ],
    });
    expect([...connectedWithin(chain, graph.nodes[1].id, 1)]).toEqual([
      graph.nodes[1].id,
      graph.nodes[0].id,
    ]);
    expect(connectedWithin(chain, graph.nodes[1].id, 2)).toEqual(
      new Set([graph.nodes[1].id, graph.nodes[0].id, third.id]),
    );
  });
  it("marks a relationship as ended only after its recorded end date", () => {
    const edge = { ...graph.edges[0], valid_to: "2024-06-30" };
    expect(relationshipEndedBefore(edge, "2024-06-30")).toBe(false);
    expect(relationshipEndedBefore(edge, "2024-07-01")).toBe(true);
    expect(relationshipEndedBefore({ ...edge, valid_to: null }, "2024-07-01")).toBe(false);
  });
  it("summarises a selected entity from its source-backed relationships", () => {
    const profile = describeEntity(graph, graph.nodes[1].id, "2026-01-01");
    expect(profile).toMatchObject({
      node: graph.nodes[1],
      relationshipTotal: 1,
      uniqueConnections: 1,
      currentRelationships: 1,
      endedRelationships: 0,
      sourceCount: 1,
    });
    expect(profile?.relationshipBreakdown).toEqual([{ predicate: "MEMBER_OF", count: 1 }]);
    expect(profile?.strongestConnections).toEqual([{ id: graph.nodes[0].id, count: 1 }]);
  });
});
