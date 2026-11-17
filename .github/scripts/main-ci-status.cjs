// Keeps one GitHub issue per workflow that is red on main (#142). Run by track-studio-ci-report.yml through
// actions/github-script after each watched workflow finishes on a push to main:
//   - red (failure, timed out, startup failure): open an issue labelled `board`, or comment on the one already open;
//   - green: comment on that issue and close it;
//   - anything else (cancelled, skipped), other branches and PR runs: nothing.
// It finds its own issues by a marker in the body and by the bot that wrote them, so a person's issue with the same
// title is never touched. Tested in apps/server/test/ci-workflows.test.ts.

const RED = new Set(["failure", "timed_out", "startup_failure"]);
const BOT = "github-actions[bot]";

/** @returns {Promise<"opened" | "commented" | "closed" | "nothing">} */
module.exports = async function mainCiStatus({ github, context, core }) {
  const run = context.payload.workflow_run;
  const { owner, repo } = context.repo;
  if (run.event !== "push" || run.head_branch !== "main") return "nothing";

  const red = RED.has(run.conclusion);
  const green = run.conclusion === "success";
  if (!red && !green) {
    core.info(`${run.name} on main: ${run.conclusion}; nothing to do.`);
    return "nothing";
  }

  const marker = `<!-- main-ci:${run.name} -->`;
  const open = await github.paginate(github.rest.issues.listForRepo, { owner, repo, state: "open", creator: BOT, per_page: 100 });
  const issue = open.find((i) => !i.pull_request && i.user?.login === BOT && (i.body || "").startsWith(marker));
  const commit = `\`${run.head_sha.slice(0, 7)}\``;
  const link = `[run ${run.run_number}](${run.html_url})`;

  if (green) {
    if (!issue) return "nothing";
    await github.rest.issues.createComment({ owner, repo, issue_number: issue.number, body: `Green again on main at ${commit} (${link}). Closing.` });
    await github.rest.issues.update({ owner, repo, issue_number: issue.number, state: "closed", state_reason: "completed" });
    return "closed";
  }

  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, { owner, repo, run_id: run.id, per_page: 100 });
  const failed = jobs.filter((j) => j.conclusion && !["success", "skipped", "neutral"].includes(j.conclusion));
  const jobLines = failed.length ? failed.map((j) => `- [${j.name}](${j.html_url}): ${j.conclusion}`) : ["- (no job details)"];
  const what = [`**${run.name}** is ${run.conclusion === "failure" ? "failing" : run.conclusion.replace("_", " ")} on main at ${commit} (${link}).`, "", ...jobLines];

  if (issue) {
    await github.rest.issues.createComment({ owner, repo, issue_number: issue.number, body: `Still red. ${what.join("\n")}` });
    return "commented";
  }

  const body = [
    marker,
    ...what,
    "",
    "Opened by the CI report workflow (.github/workflows/track-studio-ci-report.yml). It comments here while the workflow stays red on main and closes this issue when it goes green.",
  ].join("\n");
  await github.rest.issues.create({ owner, repo, title: `main is red: ${run.name}`, body, labels: ["board"] });
  return "opened";
};
