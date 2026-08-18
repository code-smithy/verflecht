const runColumns = ["Run", "Source", "Status", "Discovered", "Fetched", "Failed"];

export default function CrawlRunsPage() {
  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <p className="eyebrow">Pipeline operations</p>
        <h1>Crawl Runs</h1>
        <p>Monitor discovery, fetch, extraction, and retryable ingestion jobs.</p>
      </header>
      <section className="workspace-panel">
        <h2>Run history</h2>
        <div className="empty-table" role="table" aria-label="Crawl run history">
          {runColumns.map((column) => (
            <strong key={column}>{column}</strong>
          ))}
        </div>
      </section>
    </main>
  );
}
