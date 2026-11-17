// CI runs on every push to main as well as on PRs, and a red main is easy to see (#142). These tests read the
// workflow files under .github/workflows and exercise .github/scripts/main-ci-status.cjs, which the CI report
// workflow runs after each workflow finishes on main.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT_DIR } from "../src/config.js";

const read = (p: string) => readFileSync(join(ROOT_DIR, p), "utf8");
const workflow = (name: string) => read(`.github/workflows/${name}`);

/** The lines nested under a top-level-down YAML key path, e.g. block(text, "jobs", "test"). Enough for these files. */
function block(text: string, ...path: string[]): string {
  let lines = text.split("\n");
  const content = (l: string) => l.trim() !== "" && !l.trim().startsWith("#");
  for (const key of path) {
    const indent = lines.find(content)?.search(/\S/) ?? 0;
    const i = lines.findIndex((l) => l.startsWith(`${" ".repeat(indent)}${key}:`));
    if (i < 0) return "";
    const end = lines.findIndex((l, j) => j > i && content(l) && l.search(/\S/) <= indent);
    lines = lines.slice(i + 1, end < 0 ? undefined : end);
  }
  return lines.join("\n");
}

/** The items of a YAML block list (`- item` lines), unquoted. */
const items = (text: string) => [...text.matchAll(/^\s*- ['"]?([^'"\n]+?)['"]?\s*$/gm)].map((m) => m[1]);

/** A minimal glob for GitHub's `paths` filters: `**` crosses folders, `*` doesn't. */
const glob = (pattern: string) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\/?|\*/g, (m) => (m === "*" ? "[^/]*" : ".*"))}$`);

/** Does a push touching only `files` trigger a workflow with this `paths` list? Later patterns win, `!` excludes. */
function triggers(paths: string[], files: string[]) {
  return files.some((f) => {
    let hit = false;
    for (const p of paths) {
      if (p.startsWith("!")) {
        if (glob(p.slice(1)).test(f)) hit = false;
      } else if (glob(p).test(f)) hit = true;
    }
    return hit;
  });
}

describe("CI workflow (typecheck and Vitest)", () => {
  const ci = workflow("ci.yml");

  it("is named CI and runs on pull requests and on pushes to main", () => {
    expect(ci).toMatch(/^name: CI$/m);
    expect(block(ci, "on", "push")).toMatch(/^\s*branches: \[main\]$/m);
    expect(block(ci, "on")).toMatch(/^ {2}pull_request:/m);
  });

  it("typechecks every package and runs every package's Vitest, each reported separately", () => {
    const steps = block(ci, "jobs");
    expect(steps).toMatch(/run: pnpm typecheck/);
    for (const pkg of ["engine", "server", "web"]) expect(steps).toMatch(new RegExp(`pnpm --filter @track-studio/${pkg} test`));
    // one failing package must not hide the others' results (pnpm -r test stops at the first failure)
    expect((steps.match(/if: \$\{\{ !cancelled\(\) \}\}/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("skips docs-only changes but not the docs the tests read (design docs, the deploy runbook)", () => {
    for (const event of ["push", "pull_request"]) {
      const paths = items(block(ci, "on", event, "paths"));
      expect(paths.length, event).toBeGreaterThan(0);
      expect(triggers(paths, ["docs/PLAN.md"]), event).toBe(false);
      expect(triggers(paths, ["README.md", "docs/agents/mechanic.md", "docs/adr/0001-x.md"]), event).toBe(false);
      expect(triggers(paths, ["docs/screenshots/142-x/a.png"]), event).toBe(false);
      expect(triggers(paths, ["docs/design/tokens.json"]), event).toBe(true);
      expect(triggers(paths, ["docs/design/phone/plan.md"]), event).toBe(true);
      expect(triggers(paths, ["docs/deploy.md"]), event).toBe(true);
      expect(triggers(paths, ["packages/engine/src/bake.ts"]), event).toBe(true);
      expect(triggers(paths, ["apps/web/src/Designer.tsx"]), event).toBe(true);
      expect(triggers(paths, ["reference/examples/a.rctrack.json"]), event).toBe(true);
      expect(triggers(paths, [".github/workflows/ci.yml"]), event).toBe(true);
      expect(triggers(paths, ["docs/PLAN.md", "pnpm-lock.yaml"]), event).toBe(true);
    }
  });
});

describe("workflows on main", () => {
  // the image build (Deploy config) and Playwright (E2E) already ran on push to main; CI is new in #142
  for (const name of ["ci.yml", "e2e.yml", "deploy-config.yml"]) {
    const text = workflow(name);

    it(`${name} runs on pushes to main`, () => {
      expect(block(text, "on", "push")).toMatch(/^\s*branches: \[main\]$/m);
    });

    it(`${name} queues runs on main without cancelling them, and cancels superseded PR runs`, () => {
      const c = block(text, "concurrency");
      // one group per PR; pushes share a group per branch
      expect(c).toMatch(/group: .*github\.workflow.*github\.event\.pull_request\.number.*github\.ref/);
      expect(c).toMatch(/cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/);
    });
  }

  it("the docs-only rule matches the other workflows: a plan or agent-doc change doesn't run E2E or the image build", () => {
    for (const name of ["e2e.yml", "deploy-config.yml"]) {
      const paths = block(workflow(name), "on", "push", "paths");
      expect(paths, name).not.toMatch(/docs\/\*\*|docs\/PLAN|docs\/agents|\*\.md/);
    }
  });
});

describe("CI report", () => {
  const report = workflow("track-studio-ci-report.yml");
  // written inline: workflows: ["PR checks", "CI", ...]
  const watched = (block(report, "on", "workflow_run").match(/workflows: \[([^\]]*)\]/)?.[1] ?? "")
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""));

  it("watches every workflow that runs on main, by its name", () => {
    for (const file of ["ci.yml", "e2e.yml", "deploy-config.yml"]) {
      const name = workflow(file).match(/^name: (.+)$/m)?.[1];
      expect(watched, file).toContain(name);
    }
  });

  it("still reports on PRs, and has a separate job for runs on main that may write issues", () => {
    expect(block(report, "jobs", "report")).toMatch(/if: github\.event\.workflow_run\.event == 'pull_request'/);
    const main = block(report, "jobs", "main");
    expect(main).toMatch(/github\.event\.workflow_run\.event == 'push'/);
    expect(main).toMatch(/github\.event\.workflow_run\.head_branch == 'main'/);
    expect(block(main, "permissions")).toMatch(/issues: write/);
    expect(main).toMatch(/main-ci-status\.cjs/);
  });
});

// ------------------------------------------------------------------ main-ci-status.cjs
type Issue = { number: number; title: string; body: string; state: "open" | "closed"; labels: string[]; comments: string[]; user: { login: string; type: string } };
type Run = { name: string; event: string; head_branch: string; conclusion: string; head_sha: string; html_url: string; run_number: number; id: number };
type MainCiStatus = (args: { github: unknown; context: unknown; core: unknown }) => Promise<string>;

const require_ = createRequire(import.meta.url);
const mainCiStatus: MainCiStatus = (args) => (require_(join(ROOT_DIR, ".github/scripts/main-ci-status.cjs")) as MainCiStatus)(args);

/** Just enough of Octokit for the script: issues on one repo, and the run's jobs. */
function fakeGitHub(issues: Issue[] = [], jobs: { name: string; conclusion: string; html_url: string }[] = []) {
  const find = (n: number) => issues.find((i) => i.number === n)!;
  const github = {
    paginate: async (fn: (p: object) => Promise<{ data: unknown[] }>, params: object) => (await fn(params)).data,
    rest: {
      actions: { listJobsForWorkflowRun: async () => ({ data: jobs }) },
      issues: {
        listForRepo: async (p: { state: string; creator?: string; labels?: string }) => ({
          data: issues.filter((i) => i.state === p.state && (!p.creator || i.user.login === p.creator)),
        }),
        create: async (p: { title: string; body: string; labels: string[] }) => {
          const issue: Issue = { number: 900 + issues.length, title: p.title, body: p.body, labels: p.labels, state: "open", comments: [], user: { login: "github-actions[bot]", type: "Bot" } };
          issues.push(issue);
          return { data: issue };
        },
        createComment: async (p: { issue_number: number; body: string }) => {
          find(p.issue_number).comments.push(p.body);
          return { data: {} };
        },
        update: async (p: { issue_number: number; state: "open" | "closed" }) => {
          find(p.issue_number).state = p.state;
          return { data: {} };
        },
      },
    },
  };
  return { github, issues };
}

const run = (over: Partial<Run> = {}): Run => ({
  name: "CI", event: "push", head_branch: "main", conclusion: "failure", head_sha: "abcdef1234567890", html_url: "https://example.test/run/1", run_number: 7, id: 1, ...over,
});
const call = (github: unknown, r: Run) =>
  mainCiStatus({ github, context: { payload: { workflow_run: r }, repo: { owner: "o", repo: "r" } }, core: { info: () => {} } });

describe("main-ci-status.cjs", () => {
  it("opens one board issue when a workflow fails on main, naming the commit, the run and the failed jobs", async () => {
    const { github, issues } = fakeGitHub([], [
      { name: "typecheck", conclusion: "failure", html_url: "https://example.test/job/1" },
      { name: "engine", conclusion: "success", html_url: "https://example.test/job/2" },
    ]);
    expect(await call(github, run())).toBe("opened");
    expect(issues).toHaveLength(1);
    const [issue] = issues;
    expect(issue.title).toMatch(/main/);
    expect(issue.title).toMatch(/CI/);
    expect(issue.labels).toContain("board");
    expect(issue.body).toMatch(/abcdef1/);
    expect(issue.body).toContain("https://example.test/run/1");
    expect(issue.body).toMatch(/typecheck/);
    expect(issue.body).not.toMatch(/\bengine\b/);
  });

  it("comments on the open issue instead of opening another while the same workflow stays red", async () => {
    const { github, issues } = fakeGitHub();
    await call(github, run());
    expect(await call(github, run({ head_sha: "1234567fffffff", html_url: "https://example.test/run/2" }))).toBe("commented");
    expect(issues).toHaveLength(1);
    expect(issues[0].comments.join("\n")).toMatch(/1234567/);
  });

  it("keeps one issue per workflow", async () => {
    const { github, issues } = fakeGitHub();
    await call(github, run());
    await call(github, run({ name: "E2E" }));
    expect(issues).toHaveLength(2);
  });

  it("closes the issue, with a comment, when the workflow goes green again on main", async () => {
    const { github, issues } = fakeGitHub();
    await call(github, run());
    await call(github, run({ name: "E2E" }));
    expect(await call(github, run({ conclusion: "success", head_sha: "feedfacecafe00" }))).toBe("closed");
    const ci = issues.find((i) => /CI/.test(i.title) && !/E2E/.test(i.title))!;
    expect(ci.state).toBe("closed");
    expect(ci.comments.at(-1)).toMatch(/feedfac/);
    expect(issues.find((i) => /E2E/.test(i.title))!.state).toBe("open");
  });

  it("treats timed-out runs as red", async () => {
    const { github, issues } = fakeGitHub();
    expect(await call(github, run({ conclusion: "timed_out" }))).toBe("opened");
    expect(issues).toHaveLength(1);
  });

  it("does nothing for green runs with no open issue, cancelled or skipped runs, other branches or PR runs", async () => {
    const { github, issues } = fakeGitHub();
    expect(await call(github, run({ conclusion: "success" }))).toBe("nothing");
    expect(await call(github, run({ conclusion: "cancelled" }))).toBe("nothing");
    expect(await call(github, run({ conclusion: "skipped" }))).toBe("nothing");
    expect(await call(github, run({ head_branch: "feat/1-x" }))).toBe("nothing");
    expect(await call(github, run({ event: "pull_request" }))).toBe("nothing");
    expect(issues).toHaveLength(0);
  });

  it("ignores open issues it didn't write, even with a matching title", async () => {
    const human: Issue = { number: 5, title: "main is red: CI", body: "<!-- main-ci:CI -->", state: "open", labels: [], comments: [], user: { login: "someone", type: "User" } };
    const { github, issues } = fakeGitHub([human]);
    expect(await call(github, run())).toBe("opened");
    expect(issues).toHaveLength(2);
    expect(human.comments).toHaveLength(0);
  });
});
