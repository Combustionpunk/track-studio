import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pyFormat, pyMod, pyRound, pyRoundInt } from "../src/num.js";
import { repoRoot } from "./helpers.js";

describe("Python-compatible numerics", () => {
  it("round() ties to even on the exact binary value", () => {
    expect(pyRound(0.0625, 3)).toBe(0.062); // exact tie -> even (toFixed gives 0.063)
    expect(pyRound(-0.0625, 3)).toBe(-0.062);
    expect(pyRound(0.1875, 3)).toBe(0.188);
    expect(pyRound(2.675, 2)).toBe(2.67); // 2.675 is really 2.67499999...
    expect(pyRound(1.0005, 3)).toBe(1.0); // 1.000499999...
    expect(pyRound(9.9996, 3)).toBe(10);
    expect(pyRound(-0.0001, 3)).toBe(0);
    expect(pyFormat(0.5, 0)).toBe("0");
    expect(pyFormat(1.5, 0)).toBe("2");
    expect(pyFormat(2.5, 0)).toBe("2");
    expect(pyFormat(-1.25, 1)).toBe("-1.2");
    expect(pyFormat(123.456, 1)).toBe("123.5");
    expect(pyRoundInt(119.99999999999999)).toBe(120);
    expect(pyRoundInt(2.5)).toBe(2);
    expect(pyRoundInt(3.5)).toBe(4);
  });

  it("% takes the sign of the divisor", () => {
    expect(pyMod(-3, 100)).toBe(97);
    expect(pyMod(103, 100)).toBe(3);
    expect(pyMod(-Math.PI, 2 * Math.PI)).toBeCloseTo(Math.PI);
  });
});

describe("engine purity", () => {
  it("src/ imports no Node or DOM APIs", () => {
    const dir = join(repoRoot, "packages/engine/src");
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/from\s+["']node:|from\s+["'](fs|path|url|os|crypto)["']|\b(document|window|process|require)\b[.(]/);
    }
  });
});
