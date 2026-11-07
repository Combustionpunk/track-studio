// "Track Studio has been updated": shown when the server serves a newer build than this tab runs (#88).
import { RefreshCw } from "lucide-react";
import { messages } from "../lib/messages.js";
import { useStale } from "../lib/version.js";

/** The root route asks the server for its version when the tab regains focus (useCheckOnFocus). */
export function UpdateBanner() {
  const stale = useStale();
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
