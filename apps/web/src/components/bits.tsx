// Small shared pieces: status badge, copy button, messages, venue thumbnail.
import type { RcVenue } from "@track-studio/engine";
import { useState, type ReactNode } from "react";
import { STATUS_LABEL } from "../lib/format.js";
import type { TrackStatus } from "../lib/api.js";
import { areaBounds, rostrumPos } from "../lib/plan.js";

export function StatusBadge({ status }: { status: TrackStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>;
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
    <button type="button" className={className ?? "btn"} onClick={copy} aria-live="polite">
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

/** Non-interactive outline of a venue: area, obstacles, rostrum. */
export function VenueThumb({ venue }: { venue: RcVenue }) {
  const b = areaBounds(venue.area);
  const [rx, rz] = rostrumPos(venue.area, venue.rostrum?.side, venue.rostrum?.offset);
  const side = venue.rostrum?.side ?? "south";
  const vertical = side === "east" || side === "west";
  return (
    <svg className="venue-thumb" viewBox={`${b.x0} ${b.y0} ${b.x1 - b.x0} ${b.y1 - b.y0}`} role="img" aria-label={`${venue.info.name} outline`}>
      <rect x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} className="thumb-bg" />
      <rect x={-venue.area.length / 2} y={-venue.area.width / 2} width={venue.area.length} height={venue.area.width} className="plan-area" />
      {(venue.obstacles ?? []).map((o, i) =>
        o.type === "circle" ? (
          <circle key={i} cx={o.x} cy={-o.z} r={Math.max(o.radius, 0.3)} className="plan-obstacle" />
        ) : (
          <rect key={i} x={o.x - o.length / 2} y={-o.z - o.width / 2} width={o.length} height={o.width} transform={`rotate(${-(o.rotation ?? 0)} ${o.x} ${-o.z})`} className="plan-keepout" />
        ),
      )}
      <rect x={rx - (vertical ? 0.6 : 2.5)} y={-rz - (vertical ? 2.5 : 0.6)} width={vertical ? 1.2 : 5} height={vertical ? 5 : 1.2} rx={0.2} className="thumb-rostrum" />
    </svg>
  );
}
