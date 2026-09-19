import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function StorageWatch() {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => {});
  }, []);

  if (!health?.storageWarning) return null;

  return (
    <aside className="ai-timeouts" role="status">
      <div className="ai-timeouts-head">
        <strong>{health.storage === "blob" ? "Vercel Blob" : "Configs are not in Vercel Blob"}</strong>
        {health.storage === "blob" ? <span className="pill on">Vercel Blob</span> : <span className="pill">Local disk</span>}
      </div>
      <p>{health.storageWarning}</p>
    </aside>
  );
}
