// Tabs left open across a deploy (#88). The build stamps its version into index.html (<meta name="app-version">, see
// version-stamp.ts) and the server sends the version it serves on every API answer (x-app-version) and in /healthz.
// When they differ the tab is out of date: a banner offers a reload, and the next change of page is a full page load,
// unless an editor holds unsaved work (then only the banner shows, and the reload waits for the user).
import { useEffect, useSyncExternalStore } from "react";
import type { LoaderFunctionArgs, ShouldRevalidateFunctionArgs } from "react-router-dom";

export const VERSION_HEADER = "x-app-version";
const CHUNK_RELOAD_KEY = "ts-chunk-reload";

let mine: string | undefined;
let stale = false;
let holds = 0;
const listeners = new Set<() => void>();

/** This tab's version: what its index.html said when it loaded ("dev" without a stamped build). */
export function clientVersion(): string {
  mine ??= (typeof document !== "undefined" && document.querySelector<HTMLMetaElement>('meta[name="app-version"]')?.content) || "dev";
  return mine;
}

/** A version the server reported; null when it sent none. */
export function noteServerVersion(server: string | null | undefined): void {
  if (!server || stale || server === clientVersion()) return;
  stale = true;
  for (const l of listeners) l();
}

export const isStale = () => stale;

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether a newer version is being served than the one this tab runs. */
export const useStale = () => useSyncExternalStore(subscribe, isStale, isStale);

/** Unsaved work: no automatic reload until the returned release is called. */
export function holdReload(): () => void {
  holds++;
  let released = false;
  return () => {
    if (!released) holds--;
    released = true;
  };
}

/** Hold the reload while `unsaved` is true (the designer's and venue editor's dirty state). */
export function useHoldReload(unsaved: boolean): void {
  useEffect(() => (unsaved ? holdReload() : undefined), [unsaved]);
}

/** Ask the server which version it serves (when the tab regains focus). */
export async function checkNow(fetcher: typeof fetch = fetch): Promise<void> {
  try {
    const res = await fetcher("/healthz", { cache: "no-store", credentials: "same-origin" });
    noteServerVersion(res.headers.get(VERSION_HEADER));
  } catch {
    // offline or the server is restarting: try again next time
  }
}

/** Root route loader: out of date and nothing unsaved, so load the next page from the server instead. */
export function versionGate({ request }: Pick<LoaderFunctionArgs, "request">): null | Promise<never> {
  if (!stale || holds > 0) return null;
  window.location.assign(request.url);
  return new Promise<never>(() => {}); // keep the old page until the browser leaves it
}

/** The gate runs on each change of page; a new query string (library filters) stays in the app. */
export const gateRevalidates = ({ currentUrl, nextUrl }: Pick<ShouldRevalidateFunctionArgs, "currentUrl" | "nextUrl">) => currentUrl.pathname !== nextUrl.pathname;

/** A lazy import or preload that failed, typically a chunk a newer build has removed. */
export function isChunkError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return e.name === "ChunkLoadError" || /dynamically imported module|Importing a module script failed|Loading (?:CSS )?chunk|Unable to preload/i.test(e.message);
}

/** One automatic reload per version after a chunk-load failure; false when it already tried (so it never loops). */
export function reloadOnceForChunkError(store: Storage = sessionStorage): boolean {
  try {
    if (store.getItem(CHUNK_RELOAD_KEY) === clientVersion()) return false;
    store.setItem(CHUNK_RELOAD_KEY, clientVersion());
  } catch {
    return false; // no session storage: can't guard, so don't reload by ourselves
  }
  window.location.reload();
  return true;
}

export function resetForTests(version: string): void {
  mine = version;
  stale = false;
  holds = 0;
  listeners.clear();
}
