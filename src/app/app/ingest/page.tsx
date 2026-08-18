export default function IngestPage() {
  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <p className="eyebrow">Manual ingestion</p>
        <h1>Ingest</h1>
        <p>Add URLs, fetch source documents, extract text, and create reviewable pipeline jobs.</p>
      </header>
      <section className="workspace-panel">
        <h2>Manual URL import</h2>
        <form className="admin-form">
          <label>
            <span>Source</span>
            <select>
              <option>Select a configured source</option>
            </select>
          </label>
          <label>
            <span>URL</span>
            <input placeholder="https://example.ch/article" type="url" />
          </label>
          <button type="button">Create ingestion job</button>
        </form>
      </section>
      <section className="workspace-panel">
        <h2>Expected output</h2>
        <div className="status-grid">
          <span>Canonical URL</span>
          <span>Fetch status</span>
          <span>Content hash</span>
          <span>Extraction status</span>
        </div>
      </section>
    </main>
  );
}
