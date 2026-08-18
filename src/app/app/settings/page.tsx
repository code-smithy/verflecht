const settings = [
  "Supabase Auth roles",
  "Sensitive-topic review requirements",
  "LLM provider configuration",
  "Prompt and schema versions",
  "Audit-log retention",
];

export default function SettingsPage() {
  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <p className="eyebrow">Administration</p>
        <h1>Settings</h1>
        <p>Control access, review policy, provider configuration, and audit behaviour.</p>
      </header>
      <section className="workspace-panel">
        <h2>Configuration areas</h2>
        <ul className="check-list">
          {settings.map((setting) => (
            <li key={setting}>{setting}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
