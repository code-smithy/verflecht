const candidate = {
  subject: "Jane Example",
  predicate: "MEMBER_OF",
  object: "Example Party",
  connectionClass: "DIRECT",
  source: "Parliament Register",
  url: "https://parliament.example/jane",
  publisher: "Parliament",
  publishedAt: "2026-08-17",
  retrievedAt: "2026-08-18",
  evidence: "Jane Example is a member of Example Party.",
  contextBefore: "Official profile:",
  contextAfter: "Updated in 2026.",
  llmConfidence: "0.91",
  evidenceScore: "8",
  sourceQuality: "A",
};

const queueItems = [
  { label: "Jane Example", relation: "MEMBER_OF", score: 8, status: "Open" },
  { label: "Sicherheitsforum 2026", relation: "PARTICIPATED_IN", score: 6, status: "Assigned" },
  { label: "Example Arms AG", relation: "REPRESENTED", score: 2, status: "Open" },
];

export default function Home() {
  return (
    <main className="review-shell">
      <aside className="review-sidebar" aria-label="Review queue">
        <div>
          <p className="app-mark">Verflecht</p>
          <h1>Review</h1>
        </div>

        <nav className="queue-list">
          {queueItems.map((item) => (
            <a className="queue-item" href="#candidate" key={`${item.label}-${item.relation}`}>
              <span>
                <strong>{item.label}</strong>
                <small>{item.relation}</small>
              </span>
              <span className="queue-meta">
                <b>{item.score}</b>
                <small>{item.status}</small>
              </span>
            </a>
          ))}
        </nav>
      </aside>

      <section className="review-workspace" id="candidate">
        <header className="review-topbar">
          <div>
            <p className="eyebrow">Claim candidate</p>
            <h2>
              {candidate.subject} <span>{candidate.predicate}</span> {candidate.object}
            </h2>
          </div>
          <div className="status-group" aria-label="Candidate status">
            <span>{candidate.connectionClass}</span>
            <span>Source {candidate.sourceQuality}</span>
          </div>
        </header>

        <div className="review-grid">
          <article className="evidence-panel">
            <div className="section-heading">
              <p className="eyebrow">Evidence</p>
              <a href={candidate.url}>{candidate.source}</a>
            </div>
            <blockquote>{candidate.evidence}</blockquote>
            <div className="context-row">
              <p>{candidate.contextBefore}</p>
              <p>{candidate.contextAfter}</p>
            </div>
          </article>

          <aside className="detail-panel">
            <dl>
              <div>
                <dt>Publisher</dt>
                <dd>{candidate.publisher}</dd>
              </div>
              <div>
                <dt>Published</dt>
                <dd>{candidate.publishedAt}</dd>
              </div>
              <div>
                <dt>Retrieved</dt>
                <dd>{candidate.retrievedAt}</dd>
              </div>
              <div>
                <dt>LLM confidence</dt>
                <dd>{candidate.llmConfidence}</dd>
              </div>
              <div>
                <dt>Evidence score</dt>
                <dd>{candidate.evidenceScore}</dd>
              </div>
            </dl>
          </aside>
        </div>

        <section className="resolution-band" aria-label="Entity resolution">
          <div>
            <p className="eyebrow">Entity resolution</p>
            <h3>{candidate.subject}</h3>
            <p>exact canonical name, same party, same canton</p>
          </div>
          <meter min="0" max="1" value="0.93" aria-label="Entity resolution score" />
        </section>

        <footer className="action-bar" aria-label="Review actions">
          <button type="button" className="secondary">
            Merge entity
          </button>
          <button type="button" className="secondary">
            Create entity
          </button>
          <button type="button" className="danger">
            Reject
          </button>
          <button type="button" className="warning">
            Disputed
          </button>
          <button type="button" className="primary">
            Verify
          </button>
        </footer>
      </section>
    </main>
  );
}
