import { Link } from "react-router-dom";
import { EmptyState } from "../components/states.js";

export function NotFound({ what = "page" }: { what?: string }) {
  return (
    <div className="ts-page">
      <EmptyState
        title="Not found"
        action={
          <Link to="/" className="ts-btn">
            Back to the library
          </Link>
        }
      >
        We couldn't find that {what}. It may have been removed, or the link is wrong.
      </EmptyState>
    </div>
  );
}
