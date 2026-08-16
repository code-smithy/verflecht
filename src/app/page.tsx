export default function Home() {
  return (
    <main>
      <section
        style={{
          display: "grid",
          minHeight: "100vh",
          placeItems: "center",
          padding: "32px",
        }}
      >
        <div style={{ maxWidth: "720px" }}>
          <p
            style={{
              color: "var(--muted)",
              fontSize: "14px",
              fontWeight: 700,
              letterSpacing: 0,
              margin: "0 0 12px",
              textTransform: "uppercase",
            }}
          >
            Verflecht
          </p>
          <h1
            style={{
              fontSize: "clamp(40px, 8vw, 72px)",
              lineHeight: 1,
              margin: "0 0 20px",
            }}
          >
            Source-backed political network research.
          </h1>
          <p style={{ color: "var(--muted)", fontSize: "20px", lineHeight: 1.5, margin: 0 }}>
            Phase 0 establishes the application shell, TypeScript configuration, test runner,
            linting, formatting, and CI gates before domain logic is added.
          </p>
        </div>
      </section>
    </main>
  );
}
