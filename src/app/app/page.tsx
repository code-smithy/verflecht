const metrics = [
  { label: "Sources", value: "0", note: "Configured registries and feeds" },
  { label: "Documents", value: "0", note: "Fetched or imported records" },
  { label: "Pending Claims", value: "0", note: "Awaiting human review" },
  { label: "Public Claims", value: "0", note: "Verified and source-backed" },
];

const nextActions = [
  "Configure Supabase Auth and role checks.",
  "Connect dashboard counts to Supabase tables.",
  "Route failed ingestion jobs into retryable work.",
  "Expose reviewer workload from the review queue service.",
];

export default function InternalDashboardPage() {
  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <p className="eyebrow">Internal workspace</p>
        <h1>Dashboard</h1>
        <p>
          Operational overview for the research pipeline, review workload, and publication state.
        </p>
      </header>
      <section className="metric-grid" aria-label="Pipeline metrics">
        {metrics.map((metric) => (
          <article className="metric-card" key={metric.label}>
            <span>{metric.value}</span>
            <strong>{metric.label}</strong>
            <small>{metric.note}</small>
          </article>
        ))}
      </section>
      <section className="workspace-panel">
        <h2>Next wiring tasks</h2>
        <ul className="check-list">
          {nextActions.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
