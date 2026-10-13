// Compact viewer for forum posts (iframe). The server only lets the forum frame /embed/*.
import type { RcTrack } from "@track-studio/engine";
import { useParams, useSearchParams } from "react-router-dom";
import { DEFAULT_LAYERS, PlanView, type Layers } from "../components/PlanView.js";
import type { TrackResponse } from "../lib/api.js";
import * as fmt from "../lib/format.js";
import { useApi, useStored } from "../lib/hooks.js";

export function Embed() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const r = Number(params.get("r")) || undefined;
  const tr = useApi<TrackResponse>(`/api/tracks/${encodeURIComponent(id)}`);
  const pinned = useApi<RcTrack>(r ? `/api/tracks/${encodeURIComponent(id)}/r/${r}` : null);
  const [layers, setLayers] = useStored<Layers>("embed-layers", { ...DEFAULT_LAYERS, grid: false });

  const doc = r ? pinned.data : tr.data?.doc;
  const err = tr.error ?? pinned.error;
  const href = `/t/${encodeURIComponent(id)}${r ? `?r=${r}` : ""}`;
  if (err) {
    return (
      <div className="embed embed-msg">
        <p>{err.message}</p>
        <a href="/" target="_blank" rel="noopener">
          Track Studio
        </a>
      </div>
    );
  }
  const b = doc?.built;
  return (
    <div className="embed">
      <header className="embed-bar">
        <a href={href} target="_blank" rel="noopener" className="embed-title">
          {doc?.info.name ?? tr.data?.track.name ?? "Loading…"}
        </a>
        {b && (
          <span className="embed-stats">
            {fmt.lap(b.lapLength)} lap · {fmt.corners(b.stats.corners)} · {fmt.size(b.size)}
            {r && ` · revision ${r}`}
          </span>
        )}
        <a href={href} target="_blank" rel="noopener" className="embed-open">
          Open in Track Studio ↗
        </a>
      </header>
      {doc && b ? (
        <PlanView
          area={doc.area}
          obstacles={doc.obstacles}
          built={b}
          designFeatures={doc.design.features}
          layers={layers}
          onLayersChange={setLayers}
          compact
          label={`Plan of ${doc.info.name}`}
          className="embed-plan"
        />
      ) : (
        <div className="embed-plan loading">Loading…</div>
      )}
    </div>
  );
}
