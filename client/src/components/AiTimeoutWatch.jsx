import { useEffect, useState } from "react";
import { api } from "../api.js";
import { AI_TIMEOUT_MESSAGE, subscribeLiveAiWarning } from "../aiWatch.js";

function formatWhen(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export default function AiTimeoutWatch() {
  const [records, setRecords] = useState([]);
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState("");

  async function load() {
    try {
      const data = await api.listAiTimeouts();
      setRecords(data.records || []);
    } catch {
      /* stay with last list */
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 8000);
    const onSaved = () => load();
    window.addEventListener("wtg-ai-timeouts", onSaved);
    return () => {
      clearInterval(timer);
      window.removeEventListener("wtg-ai-timeouts", onSaved);
    };
  }, []);

  useEffect(() => subscribeLiveAiWarning(setLive), []);

  if (!live && !records.length) return null;

  return (
    <aside className="ai-timeouts" role="status">
      <div className="ai-timeouts-head">
        <strong>AI timeout (55s)</strong>
        <button type="button" className="ghost" onClick={() => setOpen((value) => !value)}>
          {open ? "Hide" : records.length ? `${records.length} saved` : "Details"}
        </button>
      </div>
      {live ? <p className="error">{live}</p> : null}
      {!live && records[0] ? <p className="error">{records[0].message || AI_TIMEOUT_MESSAGE}</p> : null}
      {open ? (
        <ol>
          {records.map((item) => (
            <li key={item.id}>
              <time dateTime={item.at}>{formatWhen(item.at)}</time>
              <span>
                {item.label} · {item.kind} · {Math.round((item.ms || 0) / 1000)}s · {item.hosting}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </aside>
  );
}
