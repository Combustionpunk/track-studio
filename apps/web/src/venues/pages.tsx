// Routes into the venue editor: /v/new and /v/:id/edit. Organisers only; everyone else is shown why not.
import { Link, useParams } from "react-router-dom";
import { Loading, Message } from "../components/bits.js";
import { ApiError } from "../lib/api.js";
import { useApi } from "../lib/hooks.js";
import { useSession } from "../lib/session.js";
import { NotFound } from "../pages/NotFound.js";
import { blankVenue, draftFromDoc } from "./model.js";
import { VenueEditor, type VenueBase } from "./VenueEditor.js";

function NotOrganiser({ back }: { back: string }) {
  const { me, loginUrl } = useSession();
  return (
    <div className="wrap page narrow">
      <h1>Organisers only</h1>
      <Message>
        {me ? (
          <>
            Venue templates are kept by the club's organisers (the forum's track-admins group). You can still look at every venue. <Link to={back}>Back</Link>
          </>
        ) : (
          <>
            Venue templates are kept by the club's organisers. <a href={loginUrl()}>Log in with the forum</a> if you're one of them.
          </>
        )}
      </Message>
    </div>
  );
}

export function NewVenuePage() {
  const { me, ready } = useSession();
  if (!ready) return <div className="wrap page"><Loading what="Loading" /></div>;
  if (!me?.organiser) return <NotOrganiser back="/v" />;
  return <VenueEditor initial={blankVenue()} />;
}

export function EditVenuePage() {
  const { id = "" } = useParams();
  const { ready } = useSession();
  const v = useApi<VenueBase & { can: { edit: boolean } }>(`/api/venues/${encodeURIComponent(id)}`);
  if (v.error) return v.error instanceof ApiError && v.error.status === 404 ? <NotFound what="venue" /> : <div className="wrap page"><Message kind="error">{v.error.message}</Message></div>;
  if (!v.data || !ready) return <div className="wrap page"><Loading what="Loading venue" /></div>;
  if (!v.data.can.edit) return <NotOrganiser back={`/v/${id}`} />;
  return <VenueEditor key={id} initial={draftFromDoc(v.data.doc)} base={v.data} />;
}
