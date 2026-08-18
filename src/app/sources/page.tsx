export default function PublicSourcesPage() {
  return (
    <main className="public-page">
      <header className="public-page-header">
        <p className="eyebrow">Public transparency</p>
        <h1>Sources</h1>
        <p>Public source summaries and quality categories for relationships shown in the graph.</p>
      </header>
      <section className="public-panel">
        <div className="source-quality-grid">
          <span>A</span>
          <p>Official primary source</p>
          <span>B</span>
          <p>Organisation or company source</p>
          <span>C</span>
          <p>Multiple reputable journalistic sources</p>
          <span>D</span>
          <p>Single reputable journalistic source</p>
          <span>E</span>
          <p>Indirect or weak signal</p>
        </div>
      </section>
    </main>
  );
}
