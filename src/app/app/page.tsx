import { DashboardClient } from "./dashboard-client";

export default function InternalDashboardPage() {
  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <p className="eyebrow">Internal workspace</p>
        <h1>Dashboard</h1>
        <p>
          Operational overview for the research pipeline, review workload, and publication state.
        </p>
      </header>
      <DashboardClient />
    </main>
  );
}
