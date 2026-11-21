import { defineConfig } from "vitest/config";

// Server tests open a real SQLite file in a temp DATA_DIR and call it synchronously, so a test that takes 20 ms can sit
// behind the machine's disk for seconds. On CI run 72 (PR #163) every running worker stalled about 5.5 s at the same
// moment: three unrelated tests took 5.5 to 5.7 s, and the one that crossed Vitest's 5 s default after the stall failed.
// The limits below only bound a stalled machine; no test waits longer, and a real hang still fails.
export default defineConfig({
  test: {
    testTimeout: 20_000,
    hookTimeout: 30_000, // afterEach closes the app and deletes its DATA_DIR
  },
});
