const reviewFields = [
  "Subject, predicate, object",
  "Connection class and validity dates",
  "Evidence text with surrounding context",
  "Source, URL, publisher, publication and retrieval dates",
  "Entity resolution candidates",
  "LLM confidence, evidence score, and source quality",
];

export default function ReviewQueuePage() {
  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <p className="eyebrow">Human verification</p>
        <h1>Review Queue</h1>
        <p>Approve, correct, dispute, or reject extracted claim candidates before publication.</p>
      </header>
      <section className="workspace-panel">
        <h2>Reviewer view</h2>
        <ul className="check-list">
          {reviewFields.map((field) => (
            <li key={field}>{field}</li>
          ))}
        </ul>
      </section>
      <section className="action-row" aria-label="Review actions">
        <button type="button">Verify</button>
        <button type="button">Edit</button>
        <button type="button">Reject</button>
        <button type="button">Mark disputed</button>
        <button type="button">Merge entity</button>
        <button type="button">Create entity</button>
      </section>
    </main>
  );
}
