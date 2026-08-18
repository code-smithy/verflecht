const statuses = ["Detected", "Pending review", "Verified", "Rejected", "Disputed", "Outdated"];

export default function ClaimsPage() {
  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <p className="eyebrow">Relationship records</p>
        <h1>Claims</h1>
        <p>Inspect claim state, evidence, correction history, and public visibility.</p>
      </header>
      <section className="workspace-panel">
        <h2>Status filters</h2>
        <div className="pill-row">
          {statuses.map((status) => (
            <button key={status} type="button">
              {status}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
