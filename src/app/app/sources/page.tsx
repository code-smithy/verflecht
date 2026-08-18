export default function InternalSourcesPage() {
  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <p className="eyebrow">Source registry</p>
        <h1>Sources</h1>
        <p>Configure domains, source type, quality rating, crawl limits, and publication rules.</p>
      </header>
      <section className="workspace-panel">
        <h2>Add source</h2>
        <form className="admin-form">
          <label>
            <span>Name</span>
            <input placeholder="Parliament Register" />
          </label>
          <label>
            <span>Domain</span>
            <input placeholder="parliament.example" />
          </label>
          <label>
            <span>Source quality</span>
            <select>
              <option>A - official primary source</option>
              <option>B - organisation or company source</option>
              <option>C - multiple reputable journalistic sources</option>
              <option>D - single reputable journalistic source</option>
              <option>E - indirect or weak signal</option>
            </select>
          </label>
          <button type="button">Save source</button>
        </form>
      </section>
    </main>
  );
}
