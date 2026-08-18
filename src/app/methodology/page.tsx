export default function MethodologyPage() {
  return (
    <main className="public-page">
      <header className="public-page-header">
        <p className="eyebrow">Publication rules</p>
        <h1>Methodology</h1>
        <p>
          Verflecht publishes only verified relationships that have concrete evidence and source
          metadata.
        </p>
      </header>
      <section className="public-panel">
        <h2>Core rules</h2>
        <ul className="check-list">
          <li>A source never automatically creates a public relationship.</li>
          <li>LLM output creates candidates only, not facts.</li>
          <li>Every public edge must resolve to source-backed evidence.</li>
          <li>Historical, official, direct, and indirect connections stay visually distinct.</li>
          <li>Corrections supersede old claims instead of silently overwriting them.</li>
        </ul>
      </section>
    </main>
  );
}
