export default function PeoplePage() {
  return (
    <main className="public-page">
      <header className="public-page-header">
        <p className="eyebrow">Public index</p>
        <h1>People</h1>
        <p>
          Browse public person profiles once verified, source-backed claims are available through
          the graph API.
        </p>
      </header>
      <section className="public-panel">
        <label className="public-search">
          <span>Search people</span>
          <input placeholder="Name, party, canton, organisation" type="search" />
        </label>
        <div className="empty-state">
          <strong>No public people yet</strong>
          <span>Verified relationships will populate this index.</span>
        </div>
      </section>
    </main>
  );
}
