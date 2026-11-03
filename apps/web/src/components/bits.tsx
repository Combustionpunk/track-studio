// Small shared pieces: status badge, copy button, messages, venue thumbnail.
import { planLayers, venueRostrum, type RcVenue } from "@track-studio/engine";
import { useId, useState, type ReactNode } from "react";
import { STATUS_LABEL } from "../lib/format.js";
import type { TrackStatus } from "../lib/api.js";
import { areaBounds } from "../lib/plan.js";

export function StatusBadge({ status }: { status: TrackStatus }) {
  return <span className={status === "draft" ? "ts-badge" : `ts-badge ts-badge--${status}`}>{STATUS_LABEL[status]}</span>;
}

export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 1800);
  };
  return (
    <button type="button" className={className ?? "ts-btn"} onClick={copy} aria-live="polite">
      {state === "done" ? "Copied" : state === "failed" ? "Copy failed" : label}
    </button>
  );
}

export function Message({ kind = "info", children }: { kind?: "info" | "error"; children: ReactNode }) {
  return (
    <div className={`msg msg-${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return <div className="loading" aria-busy="true">{what}…</div>;
}

/** Non-interactive outline of a venue (area, obstacles, rostrum), drawn by the shared plan renderer. */
export function VenueThumb({ venue }: { venue: RcVenue }) {
  const b = areaBounds(venue.area);
  const rostrum = venueRostrum(venue.area, venue.rostrum?.side, venue.rostrum?.offset);
  const uid = useId().replace(/[^\w-]/g, "");
  // drawn for a ~300 px wide card
  const drawing = planLayers({ area: venue.area, obstacles: venue.obstacles, rostrum }, { px: (b.x1 - b.x0) / 300, layers: { grid: false }, id: `venue${uid}` });
  return (
    <svg className="venue-thumb" viewBox={`${b.x0} ${b.y0} ${b.x1 - b.x0} ${b.y1 - b.y0}`} role="img" aria-label={`${venue.info.name} outline`}>
      <g dangerouslySetInnerHTML={{ __html: drawing }} />
    </svg>
  );
}
