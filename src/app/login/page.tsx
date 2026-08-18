export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-panel">
        <p className="app-mark">Verflecht</p>
        <h1>Login</h1>
        <p>Internal access for researchers, reviewers, and administrators.</p>
        <form className="admin-form">
          <label>
            <span>Email</span>
            <input autoComplete="email" placeholder="name@example.ch" type="email" />
          </label>
          <label>
            <span>Password</span>
            <input autoComplete="current-password" type="password" />
          </label>
          <button type="button">Continue</button>
        </form>
      </section>
    </main>
  );
}
