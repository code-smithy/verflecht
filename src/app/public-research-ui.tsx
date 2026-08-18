"use client";

import React, { useEffect, useMemo, useState, type PointerEvent } from "react";

import { connectionClasses, entityTypes, relationPredicates } from "@/domain/ontology";
import type {
  PublicGraphEdge,
  PublicGraphEvidence,
  PublicGraphNode,
  PublicGraphProjection,
} from "@/domain/public-graph";
import type { ConnectionClass, EntityType, RelationPredicate } from "@/domain/ontology";

type ResearchTab = "network" | "people" | "timeline" | "table";
type SortKey = "person" | "predicate" | "object" | "connectionClass" | "validFrom" | "source";

export type ResearchFilters = {
  search: string;
  entityType: "ALL" | EntityType;
  predicate: "ALL" | RelationPredicate;
  connectionClass: "ALL" | ConnectionClass;
  sourceQuality: "ALL" | string;
  includeHistorical: boolean;
};

export type PublicResearchEdge = PublicGraphEdge & {
  subject: PublicGraphNode;
  object: PublicGraphNode;
  primaryEvidence: PublicGraphEvidence;
};

export type PublicResearchViewModel = {
  nodes: PublicGraphNode[];
  edges: PublicResearchEdge[];
  people: PublicGraphNode[];
  sourceQualities: string[];
};

const initialFilters: ResearchFilters = {
  search: "",
  entityType: "ALL",
  predicate: "ALL",
  connectionClass: "ALL",
  sourceQuality: "ALL",
  includeHistorical: true,
};

const classLabels: Record<ConnectionClass, string> = {
  DIRECT: "Direct",
  INDIRECT: "Indirect",
  OFFICIAL: "Official",
  HISTORICAL: "Historical",
};

const nodeTypeLabels: Record<EntityType, string> = {
  PERSON: "Person",
  ORGANISATION: "Organisation",
  COMPANY: "Company",
  POLITICAL_PARTY: "Party",
  COMMITTEE: "Committee",
  PARLIAMENT: "Parliament",
  GOVERNMENT_BODY: "Government",
  EVENT: "Event",
  INITIATIVE: "Initiative",
  ASSOCIATION: "Association",
  MEDIA_OUTLET: "Media",
  LOCATION: "Location",
  COUNTRY: "Country",
  OTHER: "Other",
};

export function PublicResearchUi({
  graph,
  unavailableReason,
}: {
  graph: PublicGraphProjection;
  unavailableReason?: string;
}) {
  const [publicGraph, setPublicGraph] = useState(graph);
  const [dataWarning, setDataWarning] = useState(unavailableReason);
  const viewModel = useMemo(() => buildPublicResearchViewModel(publicGraph), [publicGraph]);
  const [filters, setFilters] = useState<ResearchFilters>(initialFilters);
  const [activeTab, setActiveTab] = useState<ResearchTab>("network");
  const [selectedNodeId, setSelectedNodeId] = useState(viewModel.nodes[0]?.id ?? "");
  const [selectedEdgeId, setSelectedEdgeId] = useState(viewModel.edges[0]?.id ?? "");
  const [sortKey, setSortKey] = useState<SortKey>("person");
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [draggingNodeId, setDraggingNodeId] = useState<string>();
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});

  const filtered = useMemo(() => filterResearchGraph(viewModel, filters), [filters, viewModel]);
  const sortedEdges = useMemo(
    () => sortResearchEdges(filtered.edges, sortKey),
    [filtered.edges, sortKey],
  );
  const selectedNode =
    filtered.nodes.find((node) => node.id === selectedNodeId) ?? filtered.nodes[0];
  const selectedEdge =
    filtered.edges.find((edge) => edge.id === selectedEdgeId) ??
    filtered.edges.find(
      (edge) =>
        selectedNode &&
        (edge.subjectEntityId === selectedNode.id || edge.objectEntityId === selectedNode.id),
    ) ??
    filtered.edges[0];
  const selectedDetailNode =
    selectedNode ??
    (selectedEdge
      ? filtered.nodes.find((node) => node.id === selectedEdge.subjectEntityId)
      : undefined);
  const timeline = buildTimelineItems(filtered.edges, filtered.nodes);
  const positions = {
    ...calculateNodePositions(filtered.nodes, filtered.edges),
    ...nodePositions,
  };
  const neighborIds = selectedDetailNode
    ? getNeighborIds(filtered.edges, selectedDetailNode.id)
    : new Set<string>();

  useEffect(() => {
    let active = true;

    async function loadGraph() {
      try {
        const response = await fetch("api/graph", { headers: { accept: "application/json" } });

        if (!response.ok) {
          throw new Error(`Public graph API returned ${response.status}.`);
        }

        const nextGraph = (await response.json()) as PublicGraphProjection;

        if (active) {
          setPublicGraph(nextGraph);
          setDataWarning(undefined);
        }
      } catch (error) {
        if (active) {
          setDataWarning(
            error instanceof Error ? error.message : "Public graph data could not be loaded.",
          );
        }
      }
    }

    void loadGraph();

    return () => {
      active = false;
    };
  }, []);

  function updateFilter<K extends keyof ResearchFilters>(key: K, value: ResearchFilters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function handleNodePointerMove(event: PointerEvent<SVGCircleElement>, nodeId: string) {
    if (draggingNodeId !== nodeId) {
      return;
    }

    const svg = event.currentTarget.ownerSVGElement;
    const point = svg?.createSVGPoint();

    if (!svg || !point) {
      return;
    }

    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM()?.inverse());
    setNodePositions((current) => ({
      ...current,
      [nodeId]: {
        x: (transformed.x - offset.x) / scale,
        y: (transformed.y - offset.y) / scale,
      },
    }));
  }

  return (
    <main className="public-shell">
      <aside className="research-sidebar" aria-label="Research filters">
        <div>
          <p className="app-mark">Verflecht</p>
          <h1>Public Research</h1>
        </div>

        <label className="search-box">
          <span>Search</span>
          <input
            value={filters.search}
            onChange={(event) => updateFilter("search", event.target.value)}
            placeholder="Person, organisation, source"
            type="search"
          />
        </label>

        <div className="filter-stack">
          <FilterSelect
            label="Type"
            value={filters.entityType}
            onChange={(value) => updateFilter("entityType", value as ResearchFilters["entityType"])}
            options={["ALL", ...entityTypes]}
            formatOption={formatEntityType}
          />
          <FilterSelect
            label="Relation"
            value={filters.predicate}
            onChange={(value) => updateFilter("predicate", value as ResearchFilters["predicate"])}
            options={["ALL", ...relationPredicates]}
            formatOption={formatPredicate}
          />
          <FilterSelect
            label="Class"
            value={filters.connectionClass}
            onChange={(value) =>
              updateFilter("connectionClass", value as ResearchFilters["connectionClass"])
            }
            options={["ALL", ...connectionClasses]}
            formatOption={(value) =>
              value === "ALL" ? "All classes" : classLabels[value as ConnectionClass]
            }
          />
          <FilterSelect
            label="Source"
            value={filters.sourceQuality}
            onChange={(value) => updateFilter("sourceQuality", value)}
            options={["ALL", ...viewModel.sourceQualities]}
            formatOption={(value) =>
              value === "ALL" ? "All source qualities" : `Quality ${value}`
            }
          />
        </div>

        <label className="toggle-row">
          <input
            checked={filters.includeHistorical}
            onChange={(event) => updateFilter("includeHistorical", event.target.checked)}
            type="checkbox"
          />
          <span>Historical</span>
        </label>

        {dataWarning ? <p className="data-warning">{dataWarning}</p> : null}
      </aside>

      <section className="research-workspace">
        <header className="research-topbar">
          <div>
            <p className="eyebrow">Verified graph</p>
            <h2>{filtered.edges.length} source-backed relationships</h2>
          </div>
          <nav className="tab-list" aria-label="Research views">
            {(["network", "people", "timeline", "table"] satisfies ResearchTab[]).map((tab) => (
              <button
                aria-pressed={activeTab === tab}
                className={activeTab === tab ? "active" : ""}
                key={tab}
                onClick={() => setActiveTab(tab)}
                type="button"
              >
                {formatTab(tab)}
              </button>
            ))}
          </nav>
        </header>

        <div className="research-grid">
          <section className="primary-surface">
            {activeTab === "network" ? (
              <NetworkView
                edges={filtered.edges}
                neighborIds={neighborIds}
                nodes={filtered.nodes}
                offset={offset}
                positions={positions}
                scale={scale}
                selectedEdgeId={selectedEdge?.id}
                selectedNodeId={selectedDetailNode?.id}
                onEdgeSelect={(edgeId) => {
                  setSelectedEdgeId(edgeId);
                  const edge = filtered.edges.find((item) => item.id === edgeId);
                  setSelectedNodeId(edge?.subjectEntityId ?? "");
                }}
                onNodePointerMove={handleNodePointerMove}
                onNodeSelect={(nodeId) => {
                  setSelectedNodeId(nodeId);
                  setSelectedEdgeId("");
                }}
                onOffsetChange={setOffset}
                onScaleChange={setScale}
                onNodePointerEnd={() => setDraggingNodeId(undefined)}
                onNodePointerStart={setDraggingNodeId}
              />
            ) : null}

            {activeTab === "people" ? (
              <PeopleView
                edges={filtered.edges}
                people={filtered.people}
                selectedNodeId={selectedDetailNode?.id}
                onSelect={setSelectedNodeId}
              />
            ) : null}

            {activeTab === "timeline" ? (
              <TimelineView items={timeline} onSelectClaim={setSelectedEdgeId} />
            ) : null}

            {activeTab === "table" ? (
              <ResearchTable
                edges={sortedEdges}
                sortKey={sortKey}
                onSort={setSortKey}
                onSelect={setSelectedEdgeId}
              />
            ) : null}
          </section>

          <DetailPanel
            edge={selectedEdge}
            node={selectedDetailNode}
            relatedEdges={filtered.edges}
          />
        </div>
      </section>
    </main>
  );
}

export function buildPublicResearchViewModel(
  graph: PublicGraphProjection,
): PublicResearchViewModel {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = graph.edges.flatMap((edge): PublicResearchEdge[] => {
    const subject = nodesById.get(edge.subjectEntityId);
    const object = nodesById.get(edge.objectEntityId);
    const primaryEvidence = edge.evidence.find(
      (evidence) => evidence.source.name && evidence.document.url && evidence.evidenceText,
    );

    if (!subject || !object || !primaryEvidence) {
      return [];
    }

    return [{ ...edge, subject, object, primaryEvidence }];
  });
  const visibleNodeIds = new Set(
    edges.flatMap((edge) => [edge.subjectEntityId, edge.objectEntityId]),
  );
  const nodes = graph.nodes.filter((node) => visibleNodeIds.has(node.id));
  const sourceQualities = Array.from(
    new Set(edges.flatMap((edge) => edge.evidence.map((item) => item.source.sourceQuality))),
  ).sort();

  return {
    nodes,
    edges,
    people: nodes.filter((node) => node.entityType === "PERSON").sort(compareNodes),
    sourceQualities,
  };
}

export function filterResearchGraph(
  viewModel: PublicResearchViewModel,
  filters: ResearchFilters,
): PublicResearchViewModel {
  const query = filters.search.trim().toLocaleLowerCase();
  const edges = viewModel.edges.filter((edge) => {
    if (!edge.primaryEvidence) {
      return false;
    }

    if (!filters.includeHistorical && edge.connectionClass === "HISTORICAL") {
      return false;
    }

    if (
      filters.entityType !== "ALL" &&
      edge.subject.entityType !== filters.entityType &&
      edge.object.entityType !== filters.entityType
    ) {
      return false;
    }

    if (filters.predicate !== "ALL" && edge.predicate !== filters.predicate) {
      return false;
    }

    if (filters.connectionClass !== "ALL" && edge.connectionClass !== filters.connectionClass) {
      return false;
    }

    if (
      filters.sourceQuality !== "ALL" &&
      !edge.evidence.some((evidence) => evidence.source.sourceQuality === filters.sourceQuality)
    ) {
      return false;
    }

    if (!query) {
      return true;
    }

    return [
      edge.subject.canonicalName,
      edge.object.canonicalName,
      edge.predicate,
      edge.connectionClass,
      edge.primaryEvidence.source.name,
      edge.primaryEvidence.document.publisher,
      edge.primaryEvidence.evidenceText,
    ].some((value) => value?.toLocaleLowerCase().includes(query));
  });
  const nodeIds = new Set(edges.flatMap((edge) => [edge.subjectEntityId, edge.objectEntityId]));
  const nodes = viewModel.nodes.filter((node) => nodeIds.has(node.id));
  const sourceQualities = Array.from(
    new Set(edges.flatMap((edge) => edge.evidence.map((item) => item.source.sourceQuality))),
  ).sort();

  return {
    nodes,
    edges,
    people: nodes.filter((node) => node.entityType === "PERSON").sort(compareNodes),
    sourceQualities,
  };
}

export function buildTimelineItems(edges: PublicResearchEdge[], nodes: PublicGraphNode[]) {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  return edges
    .flatMap((edge) => {
      const subject = nodesById.get(edge.subjectEntityId);
      const object = nodesById.get(edge.objectEntityId);

      if (!subject || !object) {
        return [];
      }

      return [
        {
          claimId: edge.id,
          date: edge.validFrom ?? edge.validTo ?? "Undated",
          classification: edge.connectionClass === "HISTORICAL" ? "Historical" : "Current",
          label: `${subject.canonicalName} ${formatPredicate(edge.predicate)} ${object.canonicalName}`,
          sourceName: edge.primaryEvidence.source.name,
          sourceQuality: edge.primaryEvidence.source.sourceQuality,
        },
      ];
    })
    .sort(
      (left, right) => left.date.localeCompare(right.date) || left.label.localeCompare(right.label),
    );
}

export function sortResearchEdges(edges: PublicResearchEdge[], sortKey: SortKey) {
  return [...edges].sort((left, right) => {
    const leftValue = getSortValue(left, sortKey);
    const rightValue = getSortValue(right, sortKey);

    return leftValue.localeCompare(rightValue) || left.id.localeCompare(right.id);
  });
}

function NetworkView({
  edges,
  neighborIds,
  nodes,
  offset,
  positions,
  scale,
  selectedEdgeId,
  selectedNodeId,
  onEdgeSelect,
  onNodePointerEnd,
  onNodePointerMove,
  onNodePointerStart,
  onNodeSelect,
  onOffsetChange,
  onScaleChange,
}: {
  edges: PublicResearchEdge[];
  neighborIds: Set<string>;
  nodes: PublicGraphNode[];
  offset: { x: number; y: number };
  positions: Record<string, { x: number; y: number }>;
  scale: number;
  selectedEdgeId?: string;
  selectedNodeId?: string;
  onEdgeSelect(edgeId: string): void;
  onNodePointerEnd(): void;
  onNodePointerMove(event: PointerEvent<SVGCircleElement>, nodeId: string): void;
  onNodePointerStart(nodeId: string): void;
  onNodeSelect(nodeId: string): void;
  onOffsetChange(offset: { x: number; y: number }): void;
  onScaleChange(scale: number): void;
}) {
  if (nodes.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="network-panel">
      <div className="network-toolbar" aria-label="Network controls">
        <button onClick={() => onScaleChange(Math.max(0.65, scale - 0.15))} type="button">
          -
        </button>
        <button onClick={() => onScaleChange(Math.min(1.8, scale + 0.15))} type="button">
          +
        </button>
        <button onClick={() => onOffsetChange({ x: offset.x - 28, y: offset.y })} type="button">
          Left
        </button>
        <button onClick={() => onOffsetChange({ x: offset.x + 28, y: offset.y })} type="button">
          Right
        </button>
      </div>
      <svg className="network-canvas" role="img" viewBox="0 0 940 620">
        <g transform={`translate(${offset.x} ${offset.y}) scale(${scale})`}>
          {edges.map((edge) => {
            const source = positions[edge.subjectEntityId];
            const target = positions[edge.objectEntityId];

            if (!source || !target) {
              return null;
            }

            return (
              <g key={edge.id}>
                <line
                  className={[
                    "graph-edge",
                    `edge-${edge.connectionClass.toLocaleLowerCase()}`,
                    selectedEdgeId === edge.id ? "selected" : "",
                  ].join(" ")}
                  onClick={() => onEdgeSelect(edge.id)}
                  x1={source.x}
                  x2={target.x}
                  y1={source.y}
                  y2={target.y}
                />
                <text
                  className="edge-label"
                  x={(source.x + target.x) / 2}
                  y={(source.y + target.y) / 2 - 8}
                >
                  {formatPredicate(edge.predicate)}
                </text>
              </g>
            );
          })}

          {nodes.map((node) => {
            const position = positions[node.id];
            const selected = selectedNodeId === node.id;
            const highlighted = selected || neighborIds.has(node.id);

            return (
              <g className={highlighted ? "graph-node highlighted" : "graph-node"} key={node.id}>
                <circle
                  className={`node-${node.entityType.toLocaleLowerCase()}`}
                  cx={position.x}
                  cy={position.y}
                  onClick={() => onNodeSelect(node.id)}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    onNodePointerStart(node.id);
                  }}
                  onPointerMove={(event) => onNodePointerMove(event, node.id)}
                  onPointerUp={(event) => {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                    onNodePointerEnd();
                  }}
                  r={selected ? 18 : 14}
                />
                <text x={position.x + 20} y={position.y + 5}>
                  {node.canonicalName}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="cluster-row" aria-label="Entity clusters">
        {entityTypes
          .filter((type) => nodes.some((node) => node.entityType === type))
          .map((type) => (
            <span key={type}>{formatEntityType(type)}</span>
          ))}
      </div>
    </div>
  );
}

function PeopleView({
  edges,
  people,
  selectedNodeId,
  onSelect,
}: {
  edges: PublicResearchEdge[];
  people: PublicGraphNode[];
  selectedNodeId?: string;
  onSelect(nodeId: string): void;
}) {
  if (people.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="people-list">
      {people.map((person) => {
        const personEdges = edges.filter(
          (edge) => edge.subjectEntityId === person.id || edge.objectEntityId === person.id,
        );

        return (
          <button
            className={selectedNodeId === person.id ? "person-row active" : "person-row"}
            key={person.id}
            onClick={() => onSelect(person.id)}
            type="button"
          >
            <span>
              <strong>{person.canonicalName}</strong>
              <small>{personEdges.length} relationships</small>
            </span>
            <b>{person.countryCode ?? "CH"}</b>
          </button>
        );
      })}
    </div>
  );
}

function TimelineView({
  items,
  onSelectClaim,
}: {
  items: ReturnType<typeof buildTimelineItems>;
  onSelectClaim(claimId: string): void;
}) {
  if (items.length === 0) {
    return <EmptyState />;
  }

  return (
    <ol className="timeline-list">
      {items.map((item) => (
        <li className={item.classification.toLocaleLowerCase()} key={item.claimId}>
          <button onClick={() => onSelectClaim(item.claimId)} type="button">
            <time>{item.date}</time>
            <span>{item.label}</span>
            <small>
              {item.classification} · {item.sourceName} · Quality {item.sourceQuality}
            </small>
          </button>
        </li>
      ))}
    </ol>
  );
}

function ResearchTable({
  edges,
  sortKey,
  onSelect,
  onSort,
}: {
  edges: PublicResearchEdge[];
  sortKey: SortKey;
  onSelect(edgeId: string): void;
  onSort(key: SortKey): void;
}) {
  if (edges.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <SortableHeader current={sortKey} label="Person" onSort={onSort} sortKey="person" />
            <SortableHeader
              current={sortKey}
              label="Relation"
              onSort={onSort}
              sortKey="predicate"
            />
            <SortableHeader current={sortKey} label="Target" onSort={onSort} sortKey="object" />
            <SortableHeader
              current={sortKey}
              label="Class"
              onSort={onSort}
              sortKey="connectionClass"
            />
            <SortableHeader current={sortKey} label="From" onSort={onSort} sortKey="validFrom" />
            <SortableHeader current={sortKey} label="Source" onSort={onSort} sortKey="source" />
          </tr>
        </thead>
        <tbody>
          {edges.map((edge) => (
            <tr key={edge.id} onClick={() => onSelect(edge.id)}>
              <td>{edge.subject.canonicalName}</td>
              <td>{formatPredicate(edge.predicate)}</td>
              <td>{edge.object.canonicalName}</td>
              <td>
                <span className={`class-pill ${edge.connectionClass.toLocaleLowerCase()}`}>
                  {classLabels[edge.connectionClass]}
                </span>
              </td>
              <td>{edge.validFrom ?? ""}</td>
              <td>{edge.primaryEvidence.source.name}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DetailPanel({
  edge,
  node,
  relatedEdges,
}: {
  edge?: PublicResearchEdge;
  node?: PublicGraphNode;
  relatedEdges: PublicResearchEdge[];
}) {
  const nodeEdges = node
    ? relatedEdges.filter(
        (item) => item.subjectEntityId === node.id || item.objectEntityId === node.id,
      )
    : [];

  return (
    <aside className="research-detail" aria-label="Detail panel">
      {node ? (
        <section>
          <p className="eyebrow">{formatEntityType(node.entityType)}</p>
          <h3>{node.canonicalName}</h3>
          {node.description ? <p>{node.description}</p> : null}
          <div className="metric-row">
            <span>{nodeEdges.length}</span>
            <small>verified relationships</small>
          </div>
        </section>
      ) : null}

      {edge ? (
        <section className="claim-detail">
          <p className="eyebrow">Evidence</p>
          <h4>
            {edge.subject.canonicalName} {formatPredicate(edge.predicate)}{" "}
            {edge.object.canonicalName}
          </h4>
          <span className={`class-pill ${edge.connectionClass.toLocaleLowerCase()}`}>
            {classLabels[edge.connectionClass]}
          </span>
          {edge.evidence.map((evidence) => (
            <article className="evidence-card" key={evidence.id}>
              <blockquote>{evidence.evidenceText}</blockquote>
              {evidence.contextBefore || evidence.contextAfter ? (
                <p>{[evidence.contextBefore, evidence.contextAfter].filter(Boolean).join(" ")}</p>
              ) : null}
              <dl>
                <div>
                  <dt>Source</dt>
                  <dd>{evidence.source.name}</dd>
                </div>
                <div>
                  <dt>Publisher</dt>
                  <dd>{evidence.document.publisher ?? evidence.source.name}</dd>
                </div>
                <div>
                  <dt>Published</dt>
                  <dd>{formatDate(evidence.document.publishedAt)}</dd>
                </div>
                <div>
                  <dt>Retrieved</dt>
                  <dd>{formatDate(evidence.document.retrievedAt)}</dd>
                </div>
                <div>
                  <dt>Quality</dt>
                  <dd>{evidence.source.sourceQuality}</dd>
                </div>
              </dl>
              <a href={evidence.document.url}>{evidence.document.title ?? evidence.document.url}</a>
            </article>
          ))}
        </section>
      ) : null}

      {!node && !edge ? <EmptyState /> : null}
    </aside>
  );
}

function FilterSelect({
  formatOption,
  label,
  onChange,
  options,
  value,
}: {
  formatOption(value: string): string;
  label: string;
  onChange(value: string): void;
  options: string[];
  value: string;
}) {
  return (
    <label>
      <span>{label}</span>
      <select onChange={(event) => onChange(event.target.value)} value={value}>
        {options.map((option) => (
          <option key={option} value={option}>
            {formatOption(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function SortableHeader({
  current,
  label,
  onSort,
  sortKey,
}: {
  current: SortKey;
  label: string;
  onSort(key: SortKey): void;
  sortKey: SortKey;
}) {
  return (
    <th>
      <button aria-pressed={current === sortKey} onClick={() => onSort(sortKey)} type="button">
        {label}
      </button>
    </th>
  );
}

function EmptyState() {
  return (
    <div className="empty-state">
      <strong>No public relationships</strong>
      <span>Verified, source-backed graph data will appear here.</span>
    </div>
  );
}

function calculateNodePositions(nodes: PublicGraphNode[], edges: PublicResearchEdge[]) {
  const grouped = new Map<EntityType, PublicGraphNode[]>();

  for (const node of nodes) {
    grouped.set(node.entityType, [...(grouped.get(node.entityType) ?? []), node]);
  }

  const typeOrder = Array.from(grouped.keys()).sort();
  const positions: Record<string, { x: number; y: number }> = {};

  typeOrder.forEach((type, typeIndex) => {
    const clusterNodes = grouped.get(type) ?? [];
    const centerX = 180 + (typeIndex % 3) * 280;
    const centerY = 160 + Math.floor(typeIndex / 3) * 210;

    clusterNodes.forEach((node, nodeIndex) => {
      const angle = (Math.PI * 2 * nodeIndex) / Math.max(clusterNodes.length, 1);
      const radius = clusterNodes.length > 1 ? 54 : 0;
      positions[node.id] = {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      };
    });
  });

  if (typeOrder.length === 1 && edges.length > 0) {
    nodes.forEach((node, index) => {
      positions[node.id] = {
        x: 140 + index * 140,
        y: index % 2 === 0 ? 240 : 330,
      };
    });
  }

  return positions;
}

function getNeighborIds(edges: PublicResearchEdge[], nodeId: string) {
  const ids = new Set<string>();

  for (const edge of edges) {
    if (edge.subjectEntityId === nodeId) {
      ids.add(edge.objectEntityId);
    }

    if (edge.objectEntityId === nodeId) {
      ids.add(edge.subjectEntityId);
    }
  }

  return ids;
}

function getSortValue(edge: PublicResearchEdge, sortKey: SortKey) {
  switch (sortKey) {
    case "person":
      return edge.subject.canonicalName;
    case "predicate":
      return edge.predicate;
    case "object":
      return edge.object.canonicalName;
    case "connectionClass":
      return edge.connectionClass;
    case "validFrom":
      return edge.validFrom ?? edge.validTo ?? "";
    case "source":
      return edge.primaryEvidence.source.name;
  }
}

function compareNodes(left: PublicGraphNode, right: PublicGraphNode) {
  return left.canonicalName.localeCompare(right.canonicalName);
}

function formatDate(value?: string) {
  return value?.slice(0, 10) ?? "";
}

function formatEntityType(value: string) {
  return value === "ALL" ? "All types" : nodeTypeLabels[value as EntityType];
}

function formatPredicate(value: string) {
  return value === "ALL"
    ? "All relations"
    : value
        .toLocaleLowerCase()
        .split("_")
        .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
        .join(" ");
}

function formatTab(tab: ResearchTab) {
  return tab.charAt(0).toLocaleUpperCase() + tab.slice(1);
}
