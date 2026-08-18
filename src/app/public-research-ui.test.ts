import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { PublicGraphProjection } from "@/domain/public-graph";

import {
  PublicResearchUi,
  buildPublicResearchViewModel,
  buildTimelineItems,
  filterResearchGraph,
  sortResearchEdges,
  type ResearchFilters,
} from "./public-research-ui";

const defaultFilters: ResearchFilters = {
  search: "",
  entityType: "ALL",
  predicate: "ALL",
  connectionClass: "ALL",
  sourceQuality: "ALL",
  includeHistorical: true,
};

function createGraphFixture(): PublicGraphProjection {
  return {
    nodes: [
      {
        id: "person-1",
        entityType: "PERSON",
        canonicalName: "Jane Example",
        slug: "jane-example",
        countryCode: "CH",
      },
      {
        id: "party-1",
        entityType: "POLITICAL_PARTY",
        canonicalName: "Example Party",
        slug: "example-party",
      },
      {
        id: "company-1",
        entityType: "COMPANY",
        canonicalName: "Example Arms AG",
        slug: "example-arms",
      },
      {
        id: "event-1",
        entityType: "EVENT",
        canonicalName: "Security Forum 2022",
        slug: "security-forum-2022",
      },
    ],
    edges: [
      {
        id: "claim-current",
        subjectEntityId: "person-1",
        objectEntityId: "party-1",
        predicate: "MEMBER_OF",
        connectionClass: "DIRECT",
        validFrom: "2024-01-01",
        evidence: [
          {
            id: "evidence-current",
            evidenceText: "Jane Example is listed as a member of Example Party.",
            contextBefore: "Official profile:",
            contextAfter: "Register updated in 2026.",
            document: {
              id: "document-current",
              url: "https://parliament.example/jane",
              title: "Jane Example profile",
              publisher: "Parliament",
              publishedAt: "2026-08-17T00:00:00.000Z",
              retrievedAt: "2026-08-18T00:00:00.000Z",
              accessStatus: "PUBLIC",
            },
            source: {
              id: "source-current",
              name: "Parliament Register",
              sourceType: "PARLIAMENT",
              sourceQuality: "A",
            },
          },
        ],
      },
      {
        id: "claim-historical",
        subjectEntityId: "person-1",
        objectEntityId: "company-1",
        predicate: "BOARD_MEMBER_OF",
        connectionClass: "HISTORICAL",
        validFrom: "2018-01-01",
        validTo: "2020-12-31",
        evidence: [
          {
            id: "evidence-historical",
            evidenceText: "Jane Example was a board member of Example Arms AG until 2020.",
            document: {
              id: "document-historical",
              url: "https://register.example/company",
              title: "Company registry extract",
              publisher: "Company Register",
              publishedAt: "2021-01-10T00:00:00.000Z",
              retrievedAt: "2026-08-18T00:00:00.000Z",
              accessStatus: "PUBLIC",
            },
            source: {
              id: "source-historical",
              name: "Company Register",
              sourceType: "COMPANY_REGISTER",
              sourceQuality: "B",
            },
          },
        ],
      },
      {
        id: "claim-official",
        subjectEntityId: "person-1",
        objectEntityId: "event-1",
        predicate: "SPOKE_AT",
        connectionClass: "OFFICIAL",
        validFrom: "2022-05-12",
        validTo: "2022-05-12",
        evidence: [
          {
            id: "evidence-official",
            evidenceText: "Jane Example spoke at Security Forum 2022.",
            document: {
              id: "document-official",
              url: "https://event.example/program",
              title: "Security Forum program",
              publisher: "Forum Office",
              retrievedAt: "2026-08-18T00:00:00.000Z",
              accessStatus: "PUBLIC",
            },
            source: {
              id: "source-official",
              name: "Forum Program",
              sourceType: "EVENT_PROGRAM",
              sourceQuality: "A",
            },
          },
        ],
      },
      {
        id: "claim-without-source",
        subjectEntityId: "person-1",
        objectEntityId: "party-1",
        predicate: "PRESIDENT_OF",
        connectionClass: "DIRECT",
        evidence: [],
      },
    ],
  };
}

describe("public research UI", () => {
  it("builds a display model that excludes edges without evidence and source details", () => {
    const viewModel = buildPublicResearchViewModel(createGraphFixture());

    expect(viewModel.edges.map((edge) => edge.id)).toEqual([
      "claim-current",
      "claim-historical",
      "claim-official",
    ]);
    expect(viewModel.nodes.map((node) => node.canonicalName).sort()).toEqual([
      "Example Arms AG",
      "Example Party",
      "Jane Example",
      "Security Forum 2022",
    ]);
    expect(viewModel.sourceQualities).toEqual(["A", "B"]);
  });

  it("filters graph data by relation controls, search text, source quality, and historical state", () => {
    const viewModel = buildPublicResearchViewModel(createGraphFixture());

    expect(
      filterResearchGraph(viewModel, {
        ...defaultFilters,
        predicate: "MEMBER_OF",
      }).edges.map((edge) => edge.id),
    ).toEqual(["claim-current"]);

    expect(
      filterResearchGraph(viewModel, {
        ...defaultFilters,
        search: "forum",
      }).edges.map((edge) => edge.id),
    ).toEqual(["claim-official"]);

    expect(
      filterResearchGraph(viewModel, {
        ...defaultFilters,
        sourceQuality: "B",
      }).edges.map((edge) => edge.id),
    ).toEqual(["claim-historical"]);

    expect(
      filterResearchGraph(viewModel, {
        ...defaultFilters,
        includeHistorical: false,
      }).edges.map((edge) => edge.id),
    ).toEqual(["claim-current", "claim-official"]);
  });

  it("classifies timeline entries and sorts them chronologically", () => {
    const viewModel = buildPublicResearchViewModel(createGraphFixture());
    const timeline = buildTimelineItems(viewModel.edges, viewModel.nodes);

    expect(timeline).toEqual([
      expect.objectContaining({
        claimId: "claim-historical",
        classification: "Historical",
        date: "2018-01-01",
      }),
      expect.objectContaining({
        claimId: "claim-official",
        classification: "Current",
        date: "2022-05-12",
      }),
      expect.objectContaining({
        claimId: "claim-current",
        classification: "Current",
        date: "2024-01-01",
      }),
    ]);
  });

  it("renders source and evidence details for public claims", () => {
    const html = renderToStaticMarkup(
      React.createElement(PublicResearchUi, { graph: createGraphFixture() }),
    );

    expect(html).toContain("Jane Example is listed as a member of Example Party.");
    expect(html).toContain("Parliament Register");
    expect(html).toContain("https://parliament.example/jane");
    expect(html).not.toContain("claim-without-source");
  });

  it("renders historical relationships with a distinct visual class", () => {
    const html = renderToStaticMarkup(
      React.createElement(PublicResearchUi, { graph: createGraphFixture() }),
    );

    expect(html).toContain("edge-historical");
    expect(html).toContain("edge-direct");
    expect(html).toContain("class-pill direct");
  });

  it("sorts table rows by selected research columns", () => {
    const viewModel = buildPublicResearchViewModel(createGraphFixture());

    expect(
      sortResearchEdges(viewModel.edges, "source").map((edge) => edge.primaryEvidence.source.name),
    ).toEqual(["Company Register", "Forum Program", "Parliament Register"]);
  });
});
