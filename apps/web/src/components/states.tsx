// Empty, loading and error states (docs/design/design-system.md, "States").
import { CircleAlert } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

/** What will appear here and how to add the first one, with one action. Club humour is allowed here and only here. */
export function EmptyState({ title, children, action, level = 2 }: { title: string; children?: ReactNode; action?: ReactNode; level?: 2 | 3 }) {
  const H = level === 3 ? "h3" : "h2";
  return (
    <div className="ts-empty" role="status">
      <H className="ts-empty__title">{title}</H>
      {children && <p className="ts-empty__text">{children}</p>}
      {action}
    </div>
  );
}

/** What went wrong and what to do next, plainly. */
export function ErrorAlert({ title, children, onRetry }: { title: string; children?: ReactNode; onRetry?: () => void }) {
  return (
    <div className="ts-alert" role="alert">
      <CircleAlert size={16} aria-hidden className="ts-alert__icon" />
      <div className="ts-alert__body">
        <strong>{title}</strong>
        {children && <p>{children}</p>}
        {onRetry && (
          <button type="button" className="ts-btn ts-btn--quiet ts-alert__retry" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function Skeleton({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <span className={`ts-skeleton ${className}`.trim()} style={style} aria-hidden="true" />;
}

/** Library cards while they load, sized like the real ones so nothing shifts. */
export function CardGridSkeleton({ count = 6, label = "Loading tracks" }: { count?: number; label?: string }) {
  return (
    <div className="ts-cards" role="status" aria-busy="true">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="ts-card ts-card--skeleton">
          <Skeleton className="ts-card__plan" />
          <div className="ts-card__body">
            <Skeleton className="ts-skeleton--title" />
            <Skeleton className="ts-skeleton--line" />
            <Skeleton className="ts-skeleton--figures" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The track page while it loads: head, plan well and side panel. */
export function TrackPageSkeleton() {
  return (
    <div className="ts-page" role="status" aria-busy="true">
      <span className="sr-only">Loading track…</span>
      <Skeleton className="ts-skeleton--line ts-skeleton--short" />
      <Skeleton className="ts-skeleton--heading" />
      <Skeleton className="ts-skeleton--line" />
      <div className="ts-track-grid">
        <Skeleton className="ts-plan-well ts-skeleton--plan" />
        <div className="ts-track-side">
          <Skeleton className="ts-skeleton--panel" />
          <Skeleton className="ts-skeleton--panel" />
        </div>
      </div>
    </div>
  );
}
