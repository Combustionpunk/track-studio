import { Link } from "react-router-dom";

export function NotFound({ what = "page" }: { what?: string }) {
  return (
    <div className="wrap page not-found">
      <h1>Not found</h1>
      <p>We couldn't find that {what}. It may have been removed, or the link is wrong.</p>
      <p>
        <Link to="/" className="btn">
          Back to the library
        </Link>
      </p>
    </div>
  );
}
