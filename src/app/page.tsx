"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ForceGraph from "./ForceGraph";
import { loadGraph, type Graph } from "@/lib/graph";
import { describeEntity, filterNetwork, networkWindow, type Filters } from "@/lib/network";

const defaults: Filters = { query: "", predicate: "", date: "", includeInactive: false };
const label = (s: string) => s.replaceAll("_", " ").toLowerCase();

export default function Home() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [filters, setFilters] = useState(defaults);
  const [selected, setSelected] = useState<string | null>(null);
  const [focusDistance, setFocusDistance] = useState(1);
  const [page, setPage] = useState(0);
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
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
  const profile = useMemo(
    () => (graph && selected ? describeEntity(graph, selected, filters.date || today) : null),
    [filters.date, graph, selected, today],
  );
  const edges =
    filtered?.edges.filter(
      (e) => !selected || e.subject_id === selected || e.object_id === selected,
    ) ?? [];
  const update = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setSelected(null);
    setPage(0);
  };
  const select = useCallback((id: string) => {
    setSelected(id);
    setPage(0);
  }, []);
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
        <label className="checkbox-filter">
          <input
            type="checkbox"
            checked={filters.includeInactive}
            onChange={(e) => update("includeInactive", e.target.checked)}
          />
          Include inactive people
        </label>
        <button
          onClick={() => {
            setFilters(defaults);
            setSelected(null);
            setPage(0);
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
            {!filters.includeInactive ? " · Active people only" : " · Including inactive people"}
            {filters.date ? " · Unknown date bounds are included" : ""}
          </p>
          <div className="workspace">
            <section className="network-panel" aria-label="Network graph">
              <div className="panel-bar">
                <h2>Network</h2>
                <div className="graph-heading-tools">
                  <label className="focus-distance">
                    Fade after
                    <input
                      type="number"
                      min="1"
                      max="6"
                      value={focusDistance}
                      disabled={!selected}
                      aria-label="Connection distance"
                      onChange={(event) =>
                        setFocusDistance(Math.max(1, Math.min(6, Number(event.target.value) || 1)))
                      }
                    />
                    connections
                  </label>
                  <span className="live-layout">Live force layout</span>
                </div>
              </div>
              {!visible?.nodes.length ? (
                <p className="state">No relationships match these filters.</p>
              ) : (
                <ForceGraph
                  graph={visible}
                  selected={selected}
                  focusDistance={focusDistance}
                  referenceDate={filters.date || today}
                  onSelect={select}
                />
              )}
              <p className="legend">
                <span className="people-key">● People</span>
                <span className="entity-key">● Organisations / other entities</span>
                <span className="line-key">
                  <i className="solid-line" aria-hidden="true" /> Active relationship
                </span>
                <span className="line-key">
                  <i className="dotted-line" aria-hidden="true" /> Ended relationship
                </span>
              </p>
              <p className="graph-note">
                Showing {visible?.nodes.length} of {filtered?.nodes.length} entities and{" "}
                {visible?.edges.length} of {filtered?.edges.length} links. Node size reflects the
                number of connections. Search or use the filters to focus the graph.
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
              {profile && (
                <>
                  <div className="entity-status-line">
                    <span className="entity-type">{label(profile.node.type)}</span>
                    <span
                      className={`record-status ${profile.currentRelationships ? "current" : "ended"}`}
                    >
                      {profile.currentRelationships
                        ? filters.date
                          ? "Connected on this date"
                          : "Current relationships"
                        : "Historical relationships only"}
                    </span>
                  </div>
                  <section className="entity-overview" aria-label="Entity overview">
                    <dl className="entity-stats">
                      <div>
                        <dt>Connections</dt>
                        <dd>{profile.uniqueConnections}</dd>
                      </div>
                      <div>
                        <dt>Relationships</dt>
                        <dd>{profile.relationshipTotal}</dd>
                      </div>
                      <div>
                        <dt>Current</dt>
                        <dd>{profile.currentRelationships}</dd>
                      </div>
                      <div>
                        <dt>Sources</dt>
                        <dd>{profile.sourceCount}</dd>
                      </div>
                    </dl>
                    <p className="record-coverage">
                      Record coverage: {profile.firstRecordedDate ?? "Unknown start"} —{" "}
                      {profile.lastRecordedDate ?? "Ongoing"}
                      {profile.endedRelationships
                        ? ` · ${profile.endedRelationships} ended relationships`
                        : ""}
                    </p>
                    <div className="entity-detail-group">
                      <h3>Relationship mix</h3>
                      <div className="relationship-mix">
                        {profile.relationshipBreakdown.map((item) => (
                          <span key={item.predicate}>
                            {label(item.predicate)} <strong>{item.count}</strong>
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="entity-detail-group">
                      <h3>Strongest connections</h3>
                      <div className="strongest-connections">
                        {profile.strongestConnections.slice(0, 8).map((connection) => (
                          <button key={connection.id} onClick={() => select(connection.id)}>
                            <span>{names.get(connection.id) ?? connection.id}</span>
                            <strong>{connection.count}</strong>
                          </button>
                        ))}
                      </div>
                    </div>
                  </section>
                </>
              )}
              {selected && (
                <button
                  className="show-all-relationships"
                  onClick={() => {
                    setSelected(null);
                    setPage(0);
                  }}
                >
                  Show all relationships
                </button>
              )}
              <h3 className="evidence-heading">
                {selected ? "Matching evidence" : "Relationships"}
              </h3>
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
