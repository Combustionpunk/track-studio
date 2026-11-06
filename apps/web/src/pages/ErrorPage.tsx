// The app's own error page for every route (#88), instead of React Router's developer page.
import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { isRouteErrorResponse, Link, useRouteError } from "react-router-dom";
import { messages } from "../lib/messages.js";
import { isChunkError, reloadOnceForChunkError, useStale } from "../lib/version.js";

/** One line for the Details toggle: no stack trace. */
export function errorDetail(error: unknown): string {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`.trim();
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (error && typeof error === "object" && "status" in error) {
    const e = error as { status: unknown; statusText?: unknown };
    return `${String(e.status)} ${e.statusText ? String(e.statusText) : ""}`.trim();
  }
  return String(error);
}

/** `updated`: the server serves a newer version than this tab runs. */
export function ErrorView({ error, updated }: { error: unknown; updated: boolean }) {
  const deploy = updated || isChunkError(error);
  return (
    <div className="ts-page">
      <div className="ts-error-page" role="alert">
        <TriangleAlert size={20} aria-hidden className="ts-error-page__icon" />
        <h1 className="ts-error-page__title">{deploy ? messages.updatedTitle : messages.errorTitle}</h1>
        <p className="ts-error-page__text">{deploy ? messages.updatedText : messages.errorText}</p>
        <div className="ts-error-page__actions">
          <button type="button" className="ts-btn ts-btn--primary" onClick={() => window.location.reload()}>
            {messages.reload}
          </button>
          {/* a full load: the app that failed may be an old build */}
          <Link to="/" reloadDocument className="ts-btn">
            {messages.backToLibrary}
          </Link>
        </div>
        <details className="ts-error-page__details">
          <summary>{messages.details}</summary>
          <code>{errorDetail(error)}</code>
        </details>
      </div>
    </div>
  );
}

/** Route errorElement: logs the error, and after a chunk-load failure reloads once (per version) by itself. */
export function RouteError() {
  const error = useRouteError();
  const updated = useStale();
  useEffect(() => {
    console.error(error);
    if (isChunkError(error)) reloadOnceForChunkError();
  }, [error]);
  return <ErrorView error={error} updated={updated} />;
}
