import { readdirSync, readFileSync } from "node:fs";
import { VENUE_CHECKS, type Built, type Check } from "../src/index.js";
import { pyFormat, pyMod } from "../src/num.js";
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

/** A built section as 1.7 bakes it, for comparing with older bakes: no generator, no rostrum, no venue checks. */
export function as17(b: object): Omit<Built, "generator"> {
  const { generator: _g, rostrum: _r, ...rest } = b as Built & { rostrum?: unknown };
  return { ...rest, checks: rest.checks.filter((c) => !(VENUE_CHECKS as readonly string[]).includes(c.code)) };
}

const JUMP_LABEL: Record<string, string> = { tabletop: "Tabletop", double: "Double", kicker: "Kicker", stepup: "Step-up", stepdown: "Step-down", whoops: "Whoops", bump: "Bump" };

/**
 * as17, with a jump's feature-in-corner as 1.8 reports it (info, not a warning: a technical section) and the distances
 * in messages from 0 up to the lap length (#91).
 */
export function as18(b: object): Omit<Built, "generator"> {
  const r = as17(b);
  return {
    ...r,
    checks: r.checks.map((c) => lap18(jump18(c), r.lapLength)),
  };
}

function jump18(c: Check): Check {
  if (c.code !== "feature-in-corner" || c.level !== "warning" || c.message.startsWith("crossover ")) return c;
  const [typ, ...rest] = c.message.split(" ");
  return { ...c, level: "info", message: `${JUMP_LABEL[typ]} ${rest.join(" ")} (technical section)` };
}

/** A check's "at d m" distances on the lap, 0 up to its length: "-1.5 m" was 1.5 m before the start. */
function lap18(c: Check, total: number): Check {
  return { ...c, message: c.message.replace(/at (-?\d+\.\d) m/g, (_, d: string) => `at ${pyFormat(pyMod(Number(d), total), 1)} m`) };
}
