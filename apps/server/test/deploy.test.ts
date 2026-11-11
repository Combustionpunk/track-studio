// Checks the production deploy files (docker-compose.prod.yml, deploy/) hang together. CI also runs
// `docker compose config` and `caddy validate` on them (.github/workflows/deploy-config.yml).
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT_DIR } from "../src/config.js";

const read = (p: string) => readFileSync(join(ROOT_DIR, p), "utf8");
const compose = read("docker-compose.prod.yml");
const caddyfile = read("deploy/Caddyfile");
const envExample = read(".env.example");

/** The lines nested under a YAML key path, e.g. block(compose, "services", "caddy"). Enough for this one file. */
function block(text: string, ...path: string[]): string {
  let lines = text.split("\n");
  const content = (l: string) => l.trim() !== "" && !l.trim().startsWith("#");
  for (const key of path) {
    // keys at this block's own level, not deeper ones
    const indent = lines.find(content)?.search(/\S/) ?? 0;
    const i = lines.findIndex((l) => l.startsWith(`${" ".repeat(indent)}${key}:`));
    if (i < 0) return "";
    const end = lines.findIndex((l, j) => j > i && content(l) && l.search(/\S/) <= indent);
    lines = lines.slice(i + 1, end < 0 ? undefined : end);
  }
  return lines.join("\n");
}

/** Names set in .env.example, including commented-out optional ones (`# NAME=`). */
const documented = new Set([...envExample.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));

describe("production compose", () => {
  const app = block(compose, "services", "track-studio");
  const caddy = block(compose, "services", "caddy");

  it("runs the existing image's build and Caddy", () => {
    expect(app).toMatch(/^\s*build: \.$/m);
    expect(caddy).toMatch(/^\s*image: caddy:2/m);
  });

  it("keeps data on a named volume and doesn't publish the app port (only Caddy faces the internet)", () => {
    expect(app).toMatch(/- track-studio-data:\/data$/m);
    expect(app).toMatch(/DATA_DIR: \/data/);
    expect(block(compose, "volumes")).toMatch(/^\s*track-studio-data:/m);
    expect(block(compose, "volumes")).toMatch(/^\s*caddy-data:/m);
    expect(block(app, "ports")).toBe("");
    expect(block(caddy, "ports")).toMatch(/"80:80"/);
    expect(block(caddy, "ports")).toMatch(/"443:443"/);
  });

  it("health-checks the app on /healthz and starts Caddy only once it's healthy", () => {
    expect(block(app, "healthcheck")).toMatch(/\/healthz/);
    expect(block(caddy, "depends_on", "track-studio")).toMatch(/condition: service_healthy/);
  });

  it("is production-only: dev login off, NODE_ENV=production", () => {
    expect(app).toMatch(/NODE_ENV: production/);
    expect(app).toMatch(/DEV_LOGIN: "0"/);
  });

  it("serves tracks.rcmisfits.org over HTTPS via Caddy, proxying to the app", () => {
    expect(caddyfile).toMatch(/^\{\$TRACKS_DOMAIN:tracks\.rcmisfits\.org\} \{/m);
    expect(caddyfile).toMatch(/reverse_proxy track-studio:3000/);
    expect(caddy).toMatch(/\.\/deploy\/Caddyfile:\/etc\/caddy\/Caddyfile:ro/);
  });
});

describe("secrets and settings", () => {
  it("documents every setting the server, backup, compose and Caddy read in .env.example", () => {
    const used = new Set<string>();
    for (const f of ["apps/server/src/config.ts", "apps/server/src/backup.ts", "apps/server/src/main.ts"]) {
      for (const m of read(f).matchAll(/env\.([A-Z][A-Z0-9_]*)|required\("([A-Z][A-Z0-9_]*)"\)/g)) used.add(m[1] ?? m[2]);
    }
    for (const m of compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)) used.add(m[1]);
    for (const m of caddyfile.matchAll(/\{\$([A-Z][A-Z0-9_]*)/g)) used.add(m[1]);
    for (const n of ["SPACES_SECRET", "SPACES_KEY", "SPACES_BUCKET", "SPACES_ENDPOINT", "TRACKS_DOMAIN"]) expect(used).toContain(n);
    const missing = [...used].filter((n) => !documented.has(n) && n !== "NODE_ENV");
    expect(missing).toEqual([]);
  });

  it("commits no secret values", () => {
    for (const m of envExample.matchAll(/^([A-Z_]*(SECRET|KEY))=(.*)$/gm)) expect(m[3], m[1]).toBe("");
    expect(compose).not.toMatch(/(SECRET|_KEY)\s*[:=]\s*\S/);
    expect(compose).toMatch(/env_file:/);
  });
});

describe("backup wrapper", () => {
  it("runs the image's backup inside the running app container", () => {
    const sh = read("deploy/backup.sh");
    expect(statSync(join(ROOT_DIR, "deploy/backup.sh")).mode & 0o111).not.toBe(0);
    expect(sh).toMatch(/^#!\/usr\/bin\/env bash/);
    expect(sh).toMatch(/set -euo pipefail/);
    expect(sh).toMatch(/docker compose -f docker-compose\.prod\.yml exec -T track-studio node dist\/backup\.js/);
  });

  it("is built into the image", () => {
    const build = read("apps/server/build.mjs");
    expect(build).toContain('"src/backup.ts"');
    expect(build).toContain('"src/restore.ts"');
  });
});

describe("CI image check", () => {
  const workflow = read(".github/workflows/deploy-config.yml");
  const job = block(workflow, "jobs", "image");
  const smoke = read("deploy/smoke-image.sh");

  it("runs on PRs and pushes to main that touch the image's inputs", () => {
    const paths = ["Dockerfile", "package.json", "pnpm-workspace.yaml", "tsconfig.base.json", "docs/design/**", "apps/**", "packages/**", "pnpm-lock.yaml", "docker-compose.prod.yml", ".github/workflows/deploy-config.yml"];
    for (const trigger of ["pull_request", "push"]) {
      const listed = block(workflow, "on", trigger).match(/paths: \[(.*)\]/)?.[1].split(/,\s*/) ?? [];
      expect(listed).toEqual(expect.arrayContaining(paths));
    }
    expect(block(workflow, "on", "push")).toMatch(/branches: \[main\]/);
  });

  it("builds the image with the GHA layer cache and pushes nothing", () => {
    expect(job).toMatch(/uses: docker\/build-push-action@v\d+/);
    expect(job).toMatch(/cache-from: type=gha/);
    expect(job).toMatch(/cache-to: type=gha,mode=max/);
    expect(job).toMatch(/push: false/);
    expect(job).toMatch(/load: true/);
    expect(workflow).not.toMatch(/docker\/login-action|docker push/);
  });

  it("gives the build stage the files the tests it runs read", () => {
    // packages/engine/test/plan.test.ts and apps/web/test/plan.test.ts compare the plan palette with tokens.json, and
    // apps/web/test/phone-design.test.ts reads docs/design/phone-designer.md and docs/design/phone/: the whole folder goes in
    const buildStage = read("Dockerfile").split(/^FROM .* AS runtime$/m)[0];
    expect(buildStage).toMatch(/^COPY docs\/design docs\/design$/m);
    for (const f of ["tokens.json", "phone-designer.md", "phone/phone.css"]) expect(existsSync(join(ROOT_DIR, "docs/design", f)), f).toBe(true);
  });

  it("smoke-tests the built image", () => {
    expect(job).toMatch(/run: deploy\/smoke-image\.sh track-studio:ci/);
    expect(statSync(join(ROOT_DIR, "deploy/smoke-image.sh")).mode & 0o111).not.toBe(0);
    expect(smoke).toMatch(/^#!\/usr\/bin\/env bash/);
    expect(smoke).toMatch(/set -euo pipefail/);
  });

  it("starts it in production with throwaway secrets made in the job and a temp data folder", () => {
    expect(smoke).toMatch(/SESSION_SECRET="\$\(openssl rand -hex 32\)"/);
    expect(smoke).toMatch(/DISCOURSE_CONNECT_SECRET="\$\(openssl rand -hex 32\)"/);
    expect(smoke).toMatch(/-e NODE_ENV=production/);
    // the image's own /data, on a fresh anonymous volume that cleanup deletes
    expect(smoke).toMatch(/-e DATA_DIR=\/data --mount type=volume,dst=\/data/);
    expect(smoke).toMatch(/docker rm -f -v "\$container"/);
  });

  it("waits about 60 s for /healthz to return 200 and fails otherwise", () => {
    expect(smoke).toMatch(/\/healthz/);
    expect(smoke).toMatch(/HEALTH_TIMEOUT=60/);
    expect(smoke).toMatch(/exit 1/);
  });

  it("checks the logo and the Inter and Oswald files are in the image", () => {
    expect(smoke).toContain("/app/apps/web/src/brand/logo.svg");
    expect(smoke).toMatch(/for f in Inter-Regular Inter-SemiBold Oswald-Medium Oswald-SemiBold; do test -s "\/app\/apps\/server\/fonts\/\$f\.ttf"/);
    expect(smoke).toMatch(/inter-\*\.woff2/);
    expect(smoke).toMatch(/oswald-\*\.woff2/);
  });

  it("seeds inside the container and fetches a track's card.png as a 200 image/png", () => {
    expect(smoke).toMatch(/docker exec "\$container" node dist\/seed\.js/);
    expect(smoke).toMatch(/og:image/);
    expect(smoke).toMatch(/card\.png/);
    expect(smoke).toMatch(/image\/png/);
  });

  it("keeps secrets out of the workflow and the script", () => {
    expect(workflow).not.toMatch(/\$\{\{\s*secrets\./);
    expect(`${workflow}\n${smoke}`).not.toMatch(/(SECRET|_KEY)[=:]\s*["']?[0-9a-f]{16,}/i);
  });
});

describe("runbook", () => {
  const doc = read("docs/deploy.md");
  it.each([
    ["droplet size", /droplet/i],
    ["region", /same region as the forum/i],
    ["DNS", /\bA record\b/],
    ["first deploy", /## First deploy/],
    ["updating", /## Updating/],
    ["backup", /## Backups/],
    ["restore", /## Restore/],
    ["DiscourseConnect", /discourse connect provider secrets/],
    ["allowed iframes", /allowed iframes/],
    ["CI", /## CI/],
  ])("covers %s", (_name, re) => expect(doc).toMatch(re));
});
