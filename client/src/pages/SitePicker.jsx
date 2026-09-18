import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function SitePicker({ user, onLogout, onOpenSite }) {
  const [sites, setSites] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const data = await api.listSites();
      setSites(data.sites || []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function addSite() {
    setBusy(true);
    setError("");
    try {
      const data = await api.createSite({});
      onOpenSite(data.site.id);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="studio">
      <header className="top">
        <div>
          <p className="eyebrow">WP Theme Studio</p>
          <h1>Choose a site</h1>
        </div>
        <div className="top-meta">
          <span>{user.username}</span>
          <button type="button" className="ghost" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>

      {error ? <p className="error">{error}</p> : null}

      <div className="site-grid">
        {sites.map((site) => (
          <button type="button" key={site.id} className="site-card" onClick={() => onOpenSite(site.id)}>
            <strong>{site.siteName || "Untitled site"}</strong>
            <span>{site.wpSiteUrl || "No domain yet"}</span>
            {site.installed ? <em className="pill on">Installed</em> : <em className="pill">Not installed</em>}
          </button>
        ))}
        <button type="button" className="site-card add" onClick={addSite} disabled={busy}>
          <strong>{busy ? "Creating…" : "Add new site"}</strong>
          <span>Create a blank site config and install WordPress later.</span>
        </button>
      </div>
    </div>
  );
}
