import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const referenceDir = join(repoRoot, "reference");

export function listJson(dir: string, suffix: string): { name: string; path: string }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .sort()
    .map((name) => ({ name, path: join(dir, name) }));
}

export const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

export const examples = listJson(join(referenceDir, "examples"), ".rctrack.json");
export const venues = listJson(join(referenceDir, "venues"), ".rcvenue.json");

/** Extra designs baked by the Python reference (scripts/gen_fixtures.py) to cover more code paths. */
export const extraDir = join(repoRoot, "packages", "engine", "test", "fixtures", "extra");
export const extraTracks = listJson(extraDir, ".rctrack.json");
export const extraVenues = listJson(extraDir, ".rcvenue.json");
export const allTracks = [...examples, ...extraTracks];
export const allVenues = [...venues, ...extraVenues];
