"use client";

import { useEffect, useState } from "react";
import { loadGraph, type Graph } from "@/lib/graph";

export default function Home() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    loadGraph(controller.signal)
      .then(setGraph)
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, []);

  const names = new Map(graph?.nodes.map((node) => [node.id, node.name]));
  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "64px 24px" }}>
      <p style={{ color: "var(--muted)", fontWeight: 700 }}>Verflecht</p>
      <h1>Source-backed political network research.</h1>
      <p>Explore reviewed relationships and the evidence behind them.</p>
      {failed ? (
        <p role="alert">Research data could not be loaded. Please reload to try again.</p>
      ) : !graph ? (
        <p role="status">Loading research…</p>
      ) : graph.edges.length === 0 ? (
        <section aria-label="Research status">
          <h2>No published relationships yet</h2>
          <p>Sources and reviewed research will appear here as they are added.</p>
        </section>
      ) : (
        <section aria-label="Verified relationships">
          <h2>
            {graph.edges.length} verified relationships · {graph.nodes.length} entities
          </h2>
          {graph.edges.map((edge) => (
            <article
              key={edge.id}
              style={{ borderTop: "1px solid var(--border)", padding: "24px 0" }}
            >
              <h3>
                {names.get(edge.subject_id)} → {names.get(edge.object_id)}
              </h3>
              <p>
                {edge.predicate.replaceAll("_", " ")} · {edge.connection_class}
              </p>
              {(edge.valid_from || edge.valid_to) && (
                <p>
                  Validity: {edge.valid_from ?? "Unknown start"} –{" "}
                  {edge.valid_to ?? "No recorded end"}
                </p>
              )}
              {edge.evidence.map((evidence, index) => (
                <div key={`${evidence.document.id}-${index}`}>
                  <blockquote>{evidence.text}</blockquote>
                  <a href={evidence.document.url} rel="noreferrer" target="_blank">
                    {evidence.document.title}
                  </a>
                  <p style={{ color: "var(--muted)" }}>
                    {evidence.source.name} · {evidence.source.type}
                  </p>
                </div>
              ))}
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
