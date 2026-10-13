// Manual-check CLI for the engine (Node only — not part of the pure library).
//   pnpm engine bake <track> [out]            re-bake; compares with the stored `built` if there is one
//   pnpm engine fit <track> <venue> [out]     fit search; writes the adapted copy for the first result to [out]
//   pnpm engine preview <track> [out.svg]     SVG preview from `built` (stdout without out)
//   pnpm engine validate <file>...            schema-check .rctrack.json / .rcvenue.json files
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  adapt,
  bake,
  compareBuilt,
  fits,
  previewSvg,
  validateTrack,
  validateVenue,
  type RcTrack,
  type RcVenue,
} from "../src/index.js";

// pnpm runs scripts from the package directory; resolve paths against where the user typed the command
const cwd = process.env.INIT_CWD ?? process.cwd();
const path = (p: string) => resolve(cwd, p);
const load = <T>(p: string): T => JSON.parse(readFileSync(path(p), "utf8")) as T;
const save = (p: string, data: string) => writeFileSync(path(p), data);
const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(4) : String(v));

function usage(): never {
  console.error(`usage:
  pnpm engine bake <track.rctrack.json> [out.rctrack.json]
  pnpm engine fit <track.rctrack.json> <venue.rcvenue.json> [adapted-out.rctrack.json]
  pnpm engine preview <track.rctrack.json> [out.svg]
  pnpm engine validate <file.rctrack.json|file.rcvenue.json>...`);
  process.exit(2);
}

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case "bake": {
    if (!args[0]) usage();
    const doc = load<RcTrack>(args[0]);
    const out = bake(doc);
    const b = out.built!;
    console.log(`${out.info.name}: lap ${b.lapLength} m, ${b.stats.dividerRuns} divider runs, ${b.stats.dividerLength} m of pipe, ${b.checks.length} checks`);
    for (const c of b.checks) console.log(`  ${c.level.padEnd(7)} ${c.code.padEnd(18)} ${c.message}`);
    if (doc.built) {
      const d = compareBuilt(b, doc.built);
      const runs = d.dividers.map((r) => r.maxDist);
      console.log(`compared with stored built (${doc.built.generator}):`);
      console.log(`  lap length       ${fmt(d.lapLength)} m`);
      console.log(`  racing line      ${d.racingLineCount[0]} vs ${d.racingLineCount[1]} points, max ${fmt(d.racingLineMax)} m`);
      console.log(`  dividers         ${d.dividerCount[0]} vs ${d.dividerCount[1]} runs, max ${fmt(Math.max(0, ...runs))} m`);
      console.log(`  checks           ${JSON.stringify(d.checks[0]) === JSON.stringify(d.checks[1]) ? "same" : `${d.checks[0].join(",")} vs ${d.checks[1].join(",")}`}`);
      console.log(`  footprint        bbox max ${fmt(d.footprint.bboxMax)} m, ${d.footprint.cellsDiffer ?? "n/a (different grid)"} cells differ`);
      console.log(`  identical JSON   ${JSON.stringify({ ...b, generator: "" }) === JSON.stringify({ ...doc.built, generator: "" })}`);
    }
    if (args[1]) {
      save(args[1], JSON.stringify(out, null, 1));
      console.log(`written: ${args[1]}`);
    }
    break;
  }
  case "fit": {
    if (!args[0] || !args[1]) usage();
    const track = load<RcTrack>(args[0]);
    const venue = load<RcVenue>(args[1]);
    const res = fits(track, venue);
    console.log(`${track.info.name} in ${venue.info.name} (${venue.area.length} x ${venue.area.width} m):`);
    for (const r of res) console.log(`  fits ${r.orientation.padEnd(24)} spare ${r.spare[0]} x ${r.spare[1]} m   shift ${r.shift[0]}, ${r.shift[1]}`);
    if (!res.length) console.log("  does not fit");
    if (res.length && args[2]) {
      const out = adapt(track, venue, res[0]);
      save(args[2], JSON.stringify(out, null, 1));
      console.log(`  adapted copy written: ${args[2]} - checks: ${JSON.stringify(out.built!.checks.map((c) => c.code))}`);
    }
    break;
  }
  case "preview": {
    if (!args[0]) usage();
    const svg = previewSvg(load<RcTrack>(args[0]));
    if (args[1]) save(args[1], svg);
    else process.stdout.write(`${svg}\n`);
    break;
  }
  case "validate": {
    if (!args.length) usage();
    let bad = 0;
    for (const f of args) {
      const doc = load<{ format?: string }>(f);
      const r = doc.format === "rcvenue" ? validateVenue(doc) : validateTrack(doc);
      console.log(`${r.valid ? "ok  " : "FAIL"} ${f}`);
      for (const e of r.errors) console.log(`     ${e.path || "/"} ${e.message}`);
      if (!r.valid) bad++;
    }
    process.exit(bad ? 1 : 0);
  }
  default:
    usage();
}
