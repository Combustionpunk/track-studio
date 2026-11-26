// #190: a template linked to a forum venue track shows that track's surface, read-only, with a link to change it on the
// forum's venue page (the forum is the source). On the venue page it's the Details value; in the editor (`editor`) it
// stands where the Surface select is for an unlinked template.
import { useId } from "react";
import { useSession } from "../lib/session.js";
import { forumVenueUrl, type SurfaceView } from "./forum.js";

export function ForumSurface({ view, venueId, editor = false }: { view: SurfaceView; venueId: number; editor?: boolean }) {
  const id = useId();
  const { config } = useSession();
  const value = (
    <>
      {view.surface ?? <span className="muted">Not given</span>}
      {view.environment && <> · {view.environment}</>}{" "}
      <span className="fs-source">
        {config ? (
          <a href={forumVenueUrl(config.forumUrl, venueId)} aria-label="Set on the forum: change the surface on the forum's venue page">
            Set on the forum
          </a>
        ) : (
          "Set on the forum"
        )}
      </span>
      {view.note && <span className="fs-note muted">{view.note}</span>}
    </>
  );
  if (!editor) return value;
  return (
    <div className="ve-field" role="group" aria-labelledby={`${id}-l`}>
      <span className="ve-label" id={`${id}-l`}>
        Surface
      </span>
      <p className="ve-readonly">{value}</p>
    </div>
  );
}
