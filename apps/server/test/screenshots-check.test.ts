// scripts/check-screenshots.sh: a PR may commit screenshots while it's open, but its head must not add or change
// anything under docs/screenshots/ compared with its base (docs/agents/mechanic.md, "Screenshots"). CI runs it on
// every PR (.github/workflows/pr-checks.yml).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ROOT_DIR } from "../src/config.js";

const SCRIPT = join(ROOT_DIR, "scripts", "check-screenshots.sh");
const repos: string[] = [];

/** A throwaway repo whose `main` already has a screenshot folder, like the real main. */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "shots-"));
  repos.push(dir);
  const git = (...args: string[]) => {
    const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  };
  const write = (p: string, body = "x") => {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), body);
  };
  const commit = (msg: string) => {
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", msg);
  };
  git("init", "-q", "-b", "main");
  write("README.md");
  write("docs/screenshots/4-theme/1200.png", "old");
  commit("main");
  git("checkout", "-q", "-b", "feat/99-thing");
  const check = (base = "main") => spawnSync("bash", [SCRIPT, base], { cwd: dir, encoding: "utf8" });
  return { dir, git, write, commit, check, rm: (p: string) => rmSync(join(dir, p), { recursive: true }) };
}

afterEach(() => {
  for (const d of repos.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("check-screenshots.sh", () => {
  it("passes a PR that touches nothing under docs/screenshots/ (the folders already on main are fine)", () => {
    const r = repo();
    r.write("apps/web/x.ts");
    r.commit("change");
    expect(r.check().status).toBe(0);
  });

  it("fails while the PR still adds screenshots, and points to the rule", () => {
    const r = repo();
    r.write("docs/screenshots/99-thing/1200.png");
    r.commit("screenshots");
    const res = r.check();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("docs/screenshots/99-thing/1200.png");
    expect(res.stderr).toContain("docs/agents/mechanic.md");
  });

  it("fails when the PR changes a screenshot already on main", () => {
    const r = repo();
    r.write("docs/screenshots/4-theme/1200.png", "new");
    r.commit("retake");
    expect(r.check().status).toBe(1);
  });

  it("fails when the PR moves a screenshot already on main to a new path", () => {
    const r = repo();
    r.git("mv", "docs/screenshots/4-theme", "docs/screenshots/99-thing");
    r.commit("rename");
    const res = r.check();
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("docs/screenshots/99-thing/1200.png");
  });

  it("passes once the final commit removes the PR's screenshots again", () => {
    const r = repo();
    r.write("docs/screenshots/99-thing/1200.png");
    r.commit("screenshots");
    r.rm("docs/screenshots/99-thing");
    r.commit("remove screenshots");
    expect(r.check().status).toBe(0);
  });

  it("compares with the merge base, so screenshots added on main since the branch started don't count", () => {
    const r = repo();
    r.write("apps/web/x.ts");
    r.commit("change");
    r.git("checkout", "-q", "main");
    r.write("docs/screenshots/50-other/1200.png");
    r.commit("main moves on");
    r.git("checkout", "-q", "feat/99-thing");
    expect(r.check().status).toBe(0);
  });

  it("fails loudly if the base ref doesn't exist", () => {
    const r = repo();
    const res = r.check("origin/nope");
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/origin\/nope/);
  });
});
