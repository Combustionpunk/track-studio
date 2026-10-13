// Typed client for the Track Studio API (apps/server). Errors arrive as {error, message}.
import type { FitResult, RcTrack, RcVenue, TrackStatus } from "@track-studio/engine";

export type { FitResult, RcTrack, RcVenue, TrackStatus };

export interface UserRef {
  id: number;
  username: string;
}

export interface TrackSummary {
  id: string;
  name: string;
  status: TrackStatus;
  author: UserRef;
  revision: number;
  approvedRevision: number | null;
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
  fit?: { revision: number; results: FitResult[] };
}

export interface Permissions {
  edit: boolean;
  submit: boolean;
  approve: boolean;
  archive: boolean;
  adapt: boolean;
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
  createdAt: string;
  updatedAt: string;
}

export interface FitAnswer {
  track: { id: string; revision: number };
  venue: { id: string; revision: number };
  results: FitResult[];
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

/** Query string from an object, skipping empty values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
