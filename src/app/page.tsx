"use client";

import { useEffect, useMemo, useState } from "react";
import { loadGraph, type Graph } from "@/lib/graph";
import { filterNetwork, networkWindow, type Filters } from "@/lib/network";

const defaults: Filters = { query: "", predicate: "", date: "" };
const label = (s: string) => s.replaceAll("_", " ").toLowerCase();

export default function Home() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [filters, setFilters] = useState(defaults);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    loadGraph(controller.signal)
      .then(setGraph)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [attempt]);
  const filtered = useMemo(() => (graph ? filterNetwork(graph, filters) : null), [graph, filters]);
  const visible = useMemo(() => (filtered ? networkWindow(filtered) : null), [filtered]);
  const names = useMemo(() => new Map(graph?.nodes.map((n) => [n.id, n.name])), [graph]);
  const positions = useMemo(
    () =>
      new Map(
        visible?.nodes.map((n, i) => {
          const angle = (i / visible.nodes.length) * Math.PI * 2 - Math.PI / 2;
          const radius = n.type === "PERSON" ? 240 : 125;
          return [n.id, { x: 350 + Math.cos(angle) * radius, y: 300 + Math.sin(angle) * radius }];
        }),
      ),
    [visible],
  );
  const edges =
    filtered?.edges.filter(
      (e) => !selected || e.subject_id === selected || e.object_id === selected,
    ) ?? [];
  const update = (key: keyof Filters, value: string) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setSelected(null);
    setPage(0);
  };
  const select = (id: string) => {
    setSelected(id);
    setPage(0);
  };
  return (
    <main className="explorer">
      <header className="explorer-header">
        <div>
          <p className="eyebrow">VERFLECHT / PUBLIC RESEARCH</p>
          <h1>Follow the connections.</h1>
        </div>
        <p>Official records. Visible evidence.</p>
      </header>
      <section className="filters" aria-label="Network filters">
        <label>
          Person or organisation
          <input
            type="search"
            placeholder="Search names…"
            value={filters.query}
            onChange={(e) => update("query", e.target.value)}
          />
        </label>
        <label>
          Relationship
          <select value={filters.predicate} onChange={(e) => update("predicate", e.target.value)}>
            <option value="">All relationships</option>
            {[...new Set(graph?.edges.map((e) => e.predicate))].sort().map((p) => (
              <option key={p} value={p}>
                {label(p)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Active on
          <input
            type="date"
            value={filters.date}
            onChange={(e) => update("date", e.target.value)}
          />
        </label>
        <button
          onClick={() => {
            setFilters(defaults);
            setSelected(null);
            setPage(0);
            setZoom(1);
          }}
        >
          Reset
        </button>
      </section>
      {failed ? (
        <section className="state" role="alert">
          <h2>Research data could not be loaded</h2>
          <button onClick={() => setAttempt((v) => v + 1)}>Try again</button>
        </section>
      ) : !graph ? (
        <p className="state" role="status">
          Loading research…
        </p>
      ) : !graph.edges.length ? (
        <section className="state">
          <h2>No published relationships yet</h2>
          <p>The nightly import will add official records when data is available.</p>
        </section>
      ) : (
        <>
          <p className="counts" role="status">
            {filtered?.nodes.length} entities · {filtered?.edges.length} relationships
            {filters.date ? " · Unknown date bounds are included" : ""}
          </p>
          <div className="workspace">
            <section className="network-panel" aria-label="Network graph">
              <div className="panel-bar">
                <h2>Network</h2>
                <div>
                  <button
                    aria-label="Zoom out"
                    onClick={() => setZoom((v) => Math.max(0.5, v - 0.25))}
                  >
                    −
                  </button>
                  <button onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
                  <button
                    aria-label="Zoom in"
                    onClick={() => setZoom((v) => Math.min(3, v + 0.25))}
                  >
                    +
                  </button>
                </div>
              </div>
              {!visible?.nodes.length ? (
                <p className="state">No relationships match these filters.</p>
              ) : (
                <div className="graph-scroll">
                  <svg
                    viewBox="0 0 700 600"
                    style={{ width: `${zoom * 100}%`, minWidth: 500 * zoom }}
                    aria-label="Select an entity to inspect its evidence"
                  >
                    {visible.edges.map((e) => {
                      const a = positions.get(e.subject_id)!;
                      const b = positions.get(e.object_id)!;
                      return (
                        <line
                          key={e.id}
                          x1={a.x}
                          y1={a.y}
                          x2={b.x}
                          y2={b.y}
                          className={
                            selected && (e.subject_id === selected || e.object_id === selected)
                              ? "connection active"
                              : "connection"
                          }
                        />
                      );
                    })}
                    {visible.nodes.map((n) => {
                      const p = positions.get(n.id)!;
                      return (
                        <g
                          key={n.id}
                          transform={`translate(${p.x},${p.y})`}
                          role="button"
                          tabIndex={0}
                          aria-label={`${n.name}, ${label(n.type)}`}
                          aria-pressed={selected === n.id}
                          onClick={() => select(n.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              select(n.id);
                            }
                          }}
                          className={`entity ${n.type === "PERSON" ? "person" : "organisation"} ${selected === n.id ? "selected" : ""}`}
                        >
                          <title>{n.name}</title>
                          <circle r={selected === n.id ? 11 : 7} />
                          {(visible.nodes.length <= 25 || selected === n.id) && (
                            <text y={-17} textAnchor="middle">
                              {n.name.length > 30 ? n.name.slice(0, 29) + "…" : n.name}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                </div>
              )}
              <p className="legend">
                <span>● People</span>
                <span>● Organisations / other entities</span>
              </p>
              <p className="graph-note">
                Showing {visible?.nodes.length} of {filtered?.nodes.length} entities and{" "}
                {visible?.edges.length} of {filtered?.edges.length} links. Search to narrow the
                graph. Scroll to pan when zoomed.
              </p>
              <details>
                <summary>Select an entity by name</summary>
                <div className="entity-list">
                  {filtered?.nodes.slice(0, 200).map((n) => (
                    <button key={n.id} onClick={() => select(n.id)}>
                      {n.name}
                    </button>
                  ))}
                </div>
                <p>First 200 names. Use search to narrow the list.</p>
              </details>
            </section>
            <aside className="evidence-panel" aria-label="Relationship evidence">
              <p className="eyebrow">SOURCE EVIDENCE</p>
              <h2>{selected ? names.get(selected) : "Inspect a connection"}</h2>
              {selected && (
                <button
                  onClick={() => {
                    setSelected(null);
                    setPage(0);
                  }}
                >
                  Show all relationships
                </button>
              )}
              <p>{edges.length} matching relationships</p>
              {edges.slice(page * 20, page * 20 + 20).map((e) => (
                <article key={e.id}>
                  <h3>
                    <button className="text-button" onClick={() => select(e.subject_id)}>
                      {names.get(e.subject_id)}
                    </button>{" "}
                    →{" "}
                    <button className="text-button" onClick={() => select(e.object_id)}>
                      {names.get(e.object_id)}
                    </button>
                  </h3>
                  <p className="badge">
                    {label(e.predicate)} · {label(e.connection_class)}
                  </p>
                  <p>
                    {e.valid_from ?? "Unknown start"} — {e.valid_to ?? "No recorded end"}
                  </p>
                  {e.evidence.map((item, i) => (
                    <details key={item.document.id + i}>
                      <summary>{item.source.name}</summary>
                      <blockquote>{item.text}</blockquote>
                      <a href={item.document.url} target="_blank" rel="noreferrer">
                        Open source record ↗
                      </a>
                    </details>
                  ))}
                </article>
              ))}
              {edges.length > 20 && (
                <nav aria-label="Evidence pages">
                  <button disabled={page === 0} onClick={() => setPage(page - 1)}>
                    Previous
                  </button>
                  <span>
                    {" "}
                    {page + 1} / {Math.ceil(edges.length / 20)}{" "}
                  </span>
                  <button
                    disabled={(page + 1) * 20 >= edges.length}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </button>
                </nav>
              )}
            </aside>
          </div>
        </>
      )}
    </main>
  );
}
