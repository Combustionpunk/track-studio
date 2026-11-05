// Typed client for the Track Studio API (apps/server). Errors arrive as {error, message}.
import type { FitResult, RcTrack, RcVenue, TrackStatus } from "@track-studio/engine";

export type { FitResult, RcTrack, RcVenue, TrackStatus };

/** A track's or revision's author; username is null when they have no user row (seeded or imported data, a removed forum account). */
export interface UserRef {
  id: number;
  username: string | null;
}

export type FitResultWithThumb = FitResult & { thumbUrl: string };

export interface TrackSummary {
  id: string;
  /** name of the public revision */
  name: string;
  /** workflow state of the latest revision */
  status: TrackStatus;
  author: UserRef;
  /** latest revision */
  revision: number;
  approvedRevision: number | null;
  /** what the public sees: the approved revision if there is one, else the latest */
  publicRevision: number;
  /** an approved track with a newer draft / submitted revision */
  newerRevision: { revision: number; status: TrackStatus } | null;
  /** error-level checks on the latest revision */
  errors: number;
  derivedFrom: { id: string; name: string | null; author: string | null } | null;
  /** why the track can't be changed (in the library, used by an event); changes are made on a copy */
  locked: "library" | "event" | null;
  latestPreviewUrl: string;
  lapLength: number;
  corners: number;
  /** real size from the lane edges; null for tracks not re-baked since engine 1.2 */
  size: { length: number; width: number } | null;
  area: { length: number; width: number };
  footprint: { width: number; height: number };
  venue: { id: string; name: string | null } | null;
  venueTemplateId: string | null;
  derivedFromId: string | null;
  createdAt: string;
  updatedAt: string;
  url: string;
  previewUrl: string;
  /** only in "fits venue" results */
  fit?: { revision: number; results: FitResultWithThumb[] };
}

export interface Permissions {
  edit: boolean;
  submit: boolean;
  approve: boolean;
  archive: boolean;
  adapt: boolean;
  copy: boolean;
}

export interface TrackResponse {
  track: TrackSummary;
  doc: RcTrack;
  can: Permissions;
}

export interface Revision {
  revision: number;
  createdAt: string;
  createdBy: UserRef;
  note: string | null;
  status: TrackStatus;
  previewUrl: string;
  downloadUrl: string;
}

export interface VenueSummary {
  id: string;
  name: string;
  forumVenueId: number | null;
  ownerId: number;
  revision: number;
  /** tracks drawn on this venue (any revision), archived ones not counted */
  tracks: number;
  createdAt: string;
  updatedAt: string;
}

export interface VenueRevision {
  revision: number;
  createdAt: string;
  createdBy: UserRef;
  name: string;
  area: { length: number; width: number };
  obstacles: number;
  downloadUrl: string;
}

export interface FitAnswer {
  track: { id: string; revision: number };
  venue: { id: string; revision: number };
  results: FitResultWithThumb[];
}

export interface Me {
  id: number;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  organiser: boolean;
  admin: boolean;
  moderator: boolean;
}

export interface ServerConfig {
  devLogin: boolean;
  forumUrl: string;
  baseUrl: string;
  organiserGroup: string;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    credentials: "same-origin",
    ...rest,
    headers: { accept: "application/json", ...(json !== undefined ? { "content-type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const e = (body ?? {}) as { error?: string; message?: string };
    throw new ApiError(res.status, e.error ?? "error", e.message ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export const post = <T>(path: string, json: unknown = {}) => api<T>(path, { method: "POST", json });

/** The site theme (synced from the forum), as served by GET /api/theme.json. */
export interface Theme {
  source: "forum" | "cache" | "fallback";
  syncedAt: string | null;
  scheme: { name: string; dark: boolean };
  colors: Record<string, string>;
  light: { name: string; colors: Record<string, string> } | null;
  fonts: { body: string; headings: string };
}

/** Organisers: fetch the forum's colour scheme now. `css` replaces the page's <style id="theme">. */
export const refreshTheme = () => post<{ ok: boolean; error?: string; theme: Theme; css: string }>("/api/theme/refresh");

/** Query string from an object, skipping empty values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
