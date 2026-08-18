export default function EntitiesPage() {
  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <p className="eyebrow">Canonical records</p>
        <h1>Entities</h1>
        <p>
          Manage people, organisations, companies, committees, events, initiatives, and aliases.
        </p>
      </header>
      <section className="workspace-panel">
        <h2>Entity management</h2>
        <form className="admin-form compact">
          <label>
            <span>Search entities</span>
            <input placeholder="Name, alias, party, canton" type="search" />
          </label>
          <button type="button">Create entity</button>
        </form>
      </section>
    </main>
  );
}
