import { useEffect } from "react";
import { api } from "./api.js";
import { AI_TIMEOUT_MESSAGE, AI_TIMEOUT_MS, setLiveAiWarning } from "./aiWatch.js";

export function useAiDeadline(active, meta) {
  const kind = meta?.kind || "chat";
  const label = meta?.label || "ai";

  useEffect(() => {
    if (!active) return undefined;
    const started = Date.now();
    const timer = setTimeout(() => {
      setLiveAiWarning(AI_TIMEOUT_MESSAGE);
      api
        .reportAiTimeout({
          kind,
          label,
          ms: Date.now() - started,
          source: "client",
        })
        .then(() => window.dispatchEvent(new Event("wtg-ai-timeouts")))
        .catch(() => {});
    }, AI_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
      setLiveAiWarning("");
    };
  }, [active, kind, label]);
}
