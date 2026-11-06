// "Track Studio has been updated": shown when the server serves a newer build than this tab runs (#88).
import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { messages } from "../lib/messages.js";
import { checkNow, useStale } from "../lib/version.js";

/** Also asks the server for its version when the tab regains focus (at most once a minute). */
export function UpdateBanner() {
  const stale = useStale();
  useEffect(() => {
    let last = 0;
    const onFocus = () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 60_000) return;
      last = Date.now();
      void checkNow();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);
  if (!stale) return null;
  return (
    <div className="ts-update" role="status">
      <RefreshCw size={16} aria-hidden className="ts-update__icon" />
      <p className="ts-update__text">{messages.updated}</p>
      <button type="button" className="ts-btn ts-btn--primary" onClick={() => window.location.reload()}>
        {messages.reload}
      </button>
    </div>
  );
}
