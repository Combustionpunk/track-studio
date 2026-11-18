// Download file names (#155): the server's content-disposition and the track page's "Download for the sim" use these,
// so the name the page shows is the name the browser saves.

/** A name as a file-name slug: ASCII letters, digits and hyphens, at most 60 characters; "track" when nothing is left. */
export const fileSlug = (s: string): string =>
  s.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_-]+/g, "-").toLowerCase().slice(0, 60) || "track";

/** `<slug>-r<n>.rctrack.json`, the file a track revision downloads as. */
export const rctrackFileName = (name: string, revision: number): string => `${fileSlug(name)}-r${revision}.rctrack.json`;

/** `<slug>-r<n>.rcvenue.json`, the file a venue revision downloads as. */
export const rcvenueFileName = (name: string, revision: number): string => `${fileSlug(name)}-r${revision}.rcvenue.json`;
