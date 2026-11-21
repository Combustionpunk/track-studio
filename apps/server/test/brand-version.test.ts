// The server's brand package (page theme-color, #135) is the forum's version too (#164).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

/** The brand version the forum reports as `brand_version`. */
const FORUM_BRAND_VERSION = "0.5.0";

describe("the server's brand package", () => {
  it("is the version the forum reports", () => {
    const require = createRequire(import.meta.url);
    const pkg = JSON.parse(readFileSync(require.resolve("@rcmisfits/brand/package.json"), "utf8")) as { version: string };
    expect(pkg.version).toBe(FORUM_BRAND_VERSION);
  });
});
