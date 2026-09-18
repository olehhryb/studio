import { useState } from "react";
import { api } from "../api.js";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = await api.login(username, password);
      onLogin(payload);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-panel">
        <p className="eyebrow">Authorized customers</p>
        <h1>WP Theme Studio</h1>
        <p className="lede">
          Sign in to generate a WordPress theme, Contact Form 7, pages, and images from a brief.
        </p>
        <form onSubmit={submit} className="stack">
          <label>
            Username
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Enter studio"}
          </button>
        </form>
      </div>
    </div>
  );
}
