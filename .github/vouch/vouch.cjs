const fs = require("node:fs");
const path = require("node:path");

const TRUSTED = "vouch:trusted";
const UNVOUCHED = "vouch:unvouched";
const DENOUNCED = "vouch:denounced";
const RUN_CI = "run-ci";
const VOUCH_LABELS = [TRUSTED, UNVOUCHED, DENOUNCED];
const LABEL_SPECS = [
  { name: TRUSTED, color: "1f883d", description: "The author is a collaborator, a bot or vouched for" },
  { name: UNVOUCHED, color: "fbca04", description: "The author is not vouched for yet" },
  { name: DENOUNCED, color: "d1242f", description: "The author is denounced" },
  { name: RUN_CI, color: "0969da", description: "A maintainer started CI for this pull request" },
];
const GATED_WORKFLOWS = ["ios.yml", "android.yml"];
const GATE_JOB = "gate";
const TRUSTED_STATUSES = ["bot", "collaborator", "vouched"];
const WRITE_PERMISSIONS = ["admin", "write"];
const COLLABORATOR_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"];
const VOUCHED_LIST_PATH = ".github/VOUCHED.td";
const SWEEP_WRITE_INTERVAL_MS = 1000;
const RUN_SETTLE_INTERVAL_MS = 15000;
const RUN_SETTLE_ATTEMPTS = 6;
const REPO_ROOT = path.resolve(__dirname, "..", "..");

function loadRepoFiles(root = REPO_ROOT) {
  const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
  return {
    list: read(VOUCHED_LIST_PATH),
    unvouchedNote: read(".github/vouch/pr-unvouched.md"),
    denouncedNote: read(".github/vouch/denounced.md"),
  };
}

function parseVouchedList(text) {
  const entries = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const denounced = line.startsWith("-");
    const rest = denounced ? line.slice(1) : line;
    const spaceAt = rest.indexOf(" ");
    const handle = (spaceAt === -1 ? rest : rest.slice(0, spaceAt)).toLowerCase();
    const reason = spaceAt === -1 ? null : rest.slice(spaceAt + 1).trim() || null;
    const colonAt = handle.indexOf(":");
    const platform = colonAt === -1 ? null : handle.slice(0, colonAt);
    const login = colonAt === -1 ? handle : handle.slice(colonAt + 1);
    if (!login || (platform && platform !== "github") || entries.has(login)) continue;
    entries.set(login, { denounced, reason });
  }
  return entries;
}

function listStatus(list, login) {
  const entry = login ? list.get(login.toLowerCase()) : undefined;
  if (!entry) return "unknown";
  return entry.denounced ? "denounced" : "vouched";
}

function authorStatus({ list, login, permission }) {
  if (!login) return "unknown";
  if (login.endsWith("[bot]")) return "bot";
  if (WRITE_PERMISSIONS.includes(permission)) return "collaborator";
  return listStatus(list, login);
}

function labelForStatus(status) {
  if (TRUSTED_STATUSES.includes(status)) return TRUSTED;
  if (status === "denounced") return DENOUNCED;
  return UNVOUCHED;
}

function gateDecision({ status, labels, runAttempt, actor, actorPermission }) {
  if (status === "denounced") {
    return { run: false, reason: "The author is denounced, so this pull request never builds." };
  }
  if (TRUSTED_STATUSES.includes(status)) return { run: true, reason: `The author is trusted (${status}).` };
  if (labels.includes(RUN_CI)) return { run: true, reason: `A maintainer added the \`${RUN_CI}\` label.` };
  if (runAttempt > 1 && WRITE_PERMISSIONS.includes(actorPermission)) {
    return { run: true, reason: `@${actor} re-ran this workflow.` };
  }
  return {
    run: false,
    reason:
      "The author isn't vouched for yet, so the build waits. A maintainer starts it by adding the " +
      `\`${RUN_CI}\` label, by commenting \`vouch\` on the pull request, or by re-running all jobs of this run.`,
  };
}

function fillTemplate(text, values) {
  return text.replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match)).trim();
}

function labelNames(item) {
  return (item.labels || []).map((label) => (typeof label === "string" ? label : label.name));
}

function loginOf(item) {
  return item.user ? item.user.login : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ignoreStatus(...statuses) {
  return (error) => {
    if (!statuses.includes(error.status)) throw error;
    return null;
  };
}

function createSession({ github, context, core, files, env = process.env, pace, settle }) {
  const loaded = files || loadRepoFiles();
  return {
    github,
    context,
    core,
    env,
    files: loaded,
    pace: pace || (() => sleep(SWEEP_WRITE_INTERVAL_MS)),
    settle: settle || (() => sleep(RUN_SETTLE_INTERVAL_MS)),
    pacing: false,
    repo: { owner: context.repo.owner, repo: context.repo.repo },
    list: parseVouchedList(loaded.list),
    permissions: new Map(),
    labelsReady: null,
  };
}

async function write(session, request) {
  if (session.pacing) await session.pace();
  return request();
}

function permissionOf(session, login) {
  const key = login.toLowerCase();
  if (!session.permissions.has(key)) {
    const lookup = session.github.rest.repos
      .getCollaboratorPermissionLevel({ ...session.repo, username: login })
      .then(({ data }) => data.permission, (error) => {
        if (error.status === 404) return "none";
        throw error;
      });
    session.permissions.set(key, lookup);
  }
  return session.permissions.get(key);
}

async function statusOf(session, login, association) {
  if (!login || login.endsWith("[bot]")) return authorStatus({ list: session.list, login });
  const mayHavePermission = association === undefined || COLLABORATOR_ASSOCIATIONS.includes(association);
  const permission = mayHavePermission ? await permissionOf(session, login) : "none";
  return authorStatus({ list: session.list, login, permission });
}

async function stillDenounced(session, login) {
  const { data } = await session.github.rest.repos.getContent({ ...session.repo, path: VOUCHED_LIST_PATH });
  const current = parseVouchedList(Buffer.from(data.content, data.encoding || "base64").toString("utf8"));
  return listStatus(current, login) === "denounced";
}

function ensureLabels(session) {
  if (!session.labelsReady) {
    session.labelsReady = (async () => {
      const { github, repo } = session;
      const existing = await github.paginate(github.rest.issues.listLabelsForRepo, { ...repo, per_page: 100 });
      const names = new Set(existing.map((label) => label.name.toLowerCase()));
      for (const spec of LABEL_SPECS) {
        if (names.has(spec.name)) continue;
        await write(session, () => github.rest.issues.createLabel({ ...repo, ...spec }).catch(ignoreStatus(422)));
      }
    })();
  }
  return session.labelsReady;
}

async function applyLabel(session, item, wanted, { dryRun = false, kind = "pull request" } = {}) {
  const { github, repo } = session;
  const present = VOUCH_LABELS.filter((name) => labelNames(item).includes(name));
  const missing = !present.includes(wanted);
  const extra = present.filter((name) => name !== wanted);
  if (!missing && extra.length === 0) return null;
  const change = { kind, number: item.number, state: item.state, from: present, to: wanted, item };
  if (dryRun) return change;
  if (missing) {
    await ensureLabels(session);
    await write(session, () =>
      github.rest.issues.addLabels({ ...repo, issue_number: item.number, labels: [wanted] }),
    );
  }
  for (const name of extra) {
    await write(session, () =>
      github.rest.issues.removeLabel({ ...repo, issue_number: item.number, name }).catch(ignoreStatus(404)),
    );
  }
  return change;
}

function templateValues(session, login) {
  const repository = session.context.payload.repository || {};
  return {
    author: login || "ghost",
    owner: session.repo.owner,
    repo: session.repo.repo,
    default_branch: repository.default_branch || "main",
  };
}

async function postOnce(session, number, body) {
  const { github, repo } = session;
  const comments = await github.paginate(github.rest.issues.listComments, {
    ...repo,
    issue_number: number,
    per_page: 100,
  });
  if (comments.some((comment) => (comment.body || "").trim() === body)) return false;
  await write(session, () => github.rest.issues.createComment({ ...repo, issue_number: number, body }));
  return true;
}

async function closeDenounced(session, item, kind) {
  const { github, repo, core } = session;
  if (!(await stillDenounced(session, loginOf(item)))) {
    core.warning(`Left ${kind} #${item.number} open: its author is no longer denounced on the default branch`);
    return false;
  }
  await postOnce(session, item.number, fillTemplate(session.files.denouncedNote, templateValues(session, loginOf(item))));
  if (kind === "pull request") {
    await write(session, () => github.rest.pulls.update({ ...repo, pull_number: item.number, state: "closed" }));
  } else {
    await write(session, () =>
      github.rest.issues.update({ ...repo, issue_number: item.number, state: "closed", state_reason: "not_planned" }),
    );
  }
  return true;
}

async function handlePullRequest(session, pr, { isNew }) {
  const login = loginOf(pr);
  const status = await statusOf(session, login, pr.author_association);
  const label = labelForStatus(status);
  await applyLabel(session, pr, label);
  session.core.info(`#${pr.number} by ${login || "a deleted account"}: ${status}, ${label}`);
  if (status === "denounced") {
    if (pr.state === "open") await closeDenounced(session, pr, "pull request");
    return;
  }
  if (label === UNVOUCHED && isNew) {
    await postOnce(session, pr.number, fillTemplate(session.files.unvouchedNote, templateValues(session, login)));
  }
}

async function handleIssue(session, issue) {
  const login = loginOf(issue);
  if (listStatus(session.list, login) !== "denounced") return;
  if ((await statusOf(session, login, issue.author_association)) !== "denounced") return;
  await applyLabel(session, issue, DENOUNCED, { kind: "issue" });
  if (issue.state === "open" && (await closeDenounced(session, issue, "issue"))) {
    session.core.info(`Closed issue #${issue.number} by denounced ${login}`);
  }
}

function runBelongsTo(pr) {
  const headRepository = pr.head.repo ? pr.head.repo.full_name : null;
  return (run) =>
    Boolean(headRepository) &&
    run.head_branch === pr.head.ref &&
    Boolean(run.head_repository) &&
    run.head_repository.full_name === headRepository;
}

async function newestRun(session, workflow, pr, { waitForCompletion }) {
  const { github, repo } = session;
  for (let attempt = 1; ; attempt += 1) {
    const { data } = await github.rest.actions.listWorkflowRuns({
      ...repo,
      workflow_id: workflow,
      event: "pull_request",
      head_sha: pr.head.sha,
      per_page: 100,
    });
    const newest = data.workflow_runs.find(runBelongsTo(pr)) || null;
    const settled = !newest || newest.status === "completed";
    if (settled || !waitForCompletion || attempt === RUN_SETTLE_ATTEMPTS) return newest;
    await session.settle();
  }
}

async function rerunSkippedBuilds(session, pr, { waitForCompletion = false } = {}) {
  const { github, repo, core } = session;
  const headSha = pr.head && pr.head.sha;
  const started = [];
  if (!headSha) return started;
  for (const workflow of GATED_WORKFLOWS) {
    const newest = await newestRun(session, workflow, pr, { waitForCompletion });
    if (!newest || newest.status !== "completed" || newest.conclusion !== "success") continue;
    const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
      ...repo,
      run_id: newest.id,
      filter: "latest",
      per_page: 100,
    });
    const gateSkippedTheBuild =
      jobs.some((job) => job.name === GATE_JOB && job.conclusion === "success") &&
      jobs.some((job) => job.name !== GATE_JOB && job.conclusion === "skipped");
    if (!gateSkippedTheBuild) continue;
    try {
      await write(session, () => github.rest.actions.reRunWorkflow({ ...repo, run_id: newest.id }));
      started.push({ workflow, runId: newest.id, number: pr.number });
      core.info(`Re-ran ${workflow} run ${newest.id} for #${pr.number}`);
    } catch (error) {
      core.warning(`Could not re-run ${workflow} run ${newest.id} for #${pr.number}: ${error.message}`);
    }
  }
  return started;
}

async function openIssuesBy(session, login) {
  const { github, repo } = session;
  const issues = await github
    .paginate(github.rest.issues.listForRepo, { ...repo, creator: login, state: "open", per_page: 100 })
    .catch(ignoreStatus(404, 422));
  return (issues || []).filter((issue) => !issue.pull_request);
}

function describeChange(change) {
  return `${change.kind} #${change.number}: ${change.from.join(" + ") || "no label"} -> ${change.to}`;
}

async function writeSweepSummary(session, report) {
  const lines = [
    `## Vouch sweep${report.dryRun ? " (dry run, nothing written)" : ""}`,
    "",
    "| Label | Pull requests |",
    "| --- | --- |",
    ...VOUCH_LABELS.map((label) => `| \`${label}\` | ${report.counts[label]} |`),
    "",
    report.changes.length
      ? `### ${report.dryRun ? "Would change" : "Changed"} (${report.changes.length})`
      : "No label changes.",
    ...report.changes.map((change) => `- ${describeChange(change)}`),
    "",
    report.closed.length
      ? `### ${report.dryRun ? "Would close" : "Closed"} (${report.closed.length})`
      : "Nothing to close.",
    ...report.closed.map((item) => `- ${item.kind} #${item.number} by ${item.login}`),
    "",
    report.rerun.length ? `### Builds started (${report.rerun.length})` : "No waiting builds to start.",
    ...report.rerun.map((item) => `- ${item.workflow} for pull request #${item.number}`),
  ];
  await session.core.summary.addRaw(lines.join("\n")).write();
}

async function sweep(session, { dryRun }) {
  const { github, repo, core } = session;
  session.pacing = !dryRun;
  const report = {
    dryRun,
    counts: Object.fromEntries(VOUCH_LABELS.map((label) => [label, 0])),
    changes: [],
    closed: [],
    rerun: [],
  };
  const mayHaveWaitingBuild = [];
  const pulls = await github.paginate(github.rest.pulls.list, { ...repo, state: "all", per_page: 100 });
  for (const pr of pulls) {
    const login = loginOf(pr);
    const status = await statusOf(session, login, pr.author_association);
    const label = labelForStatus(status);
    report.counts[label] += 1;
    const approved = label === TRUSTED || (label === UNVOUCHED && labelNames(pr).includes(RUN_CI));
    if (pr.state === "open" && approved) mayHaveWaitingBuild.push(pr);
    const change = await applyLabel(session, pr, label, { dryRun });
    if (change) {
      report.changes.push(change);
      core.info(`${dryRun ? "Would change" : "Changed"} ${describeChange(change)}`);
    }
    if (status === "denounced" && pr.state === "open") {
      core.info(`${dryRun ? "Would close" : "Closing"} pull request #${pr.number} by ${login}`);
      if (dryRun || (await closeDenounced(session, pr, "pull request"))) {
        report.closed.push({ kind: "pull request", number: pr.number, login });
      }
    }
  }
  for (const [login, entry] of session.list) {
    if (!entry.denounced || (await statusOf(session, login)) !== "denounced") continue;
    for (const issue of await openIssuesBy(session, login)) {
      core.info(`${dryRun ? "Would close" : "Closing"} issue #${issue.number} by ${login}`);
      const change = await applyLabel(session, issue, DENOUNCED, { dryRun, kind: "issue" });
      if (change) report.changes.push(change);
      if (dryRun || (await closeDenounced(session, issue, "issue"))) {
        report.closed.push({ kind: "issue", number: issue.number, login });
      }
    }
  }
  if (!dryRun) {
    for (const pr of mayHaveWaitingBuild) report.rerun.push(...(await rerunSkippedBuilds(session, pr)));
  }
  await writeSweepSummary(session, report);
  return report;
}

function isRecheck(payload) {
  const issue = payload.issue || {};
  const body = ((payload.comment || {}).body || "").trim();
  return Boolean(issue.pull_request) && issue.state === "open" && body === "/recheck";
}

async function run(args) {
  const session = createSession(args);
  const { eventName, payload } = session.context;
  const action = payload.action;
  if (eventName === "pull_request_target" && action === "labeled") {
    if (payload.label && payload.label.name === RUN_CI && payload.pull_request.state === "open") {
      return rerunSkippedBuilds(session, payload.pull_request, { waitForCompletion: true });
    }
    return null;
  }
  if (eventName === "pull_request_target" && (action === "opened" || action === "reopened")) {
    return handlePullRequest(session, payload.pull_request, { isNew: action === "opened" });
  }
  if (eventName === "issues" && (action === "opened" || action === "reopened")) {
    return handleIssue(session, payload.issue);
  }
  if (eventName === "issue_comment" && isRecheck(payload)) {
    return handlePullRequest(session, payload.issue, { isNew: false });
  }
  if (eventName === "schedule" || eventName === "push") return sweep(session, { dryRun: false });
  if (eventName === "workflow_dispatch") {
    return sweep(session, { dryRun: String((payload.inputs || {}).dry_run) === "true" });
  }
  session.core.info(`Nothing to do for ${eventName} ${action || ""}`.trim());
  return null;
}

async function listChanged(args) {
  return sweep(createSession(args), { dryRun: false });
}

async function gate(args) {
  const session = createSession(args);
  const { github, repo, context, env, core } = session;
  let decision;
  if (context.eventName !== "pull_request") {
    decision = { run: true, reason: `A ${context.eventName} run always builds.` };
  } else {
    const { data: pr } = await github.rest.pulls.get({ ...repo, pull_number: context.payload.pull_request.number });
    const runAttempt = Number(env.GITHUB_RUN_ATTEMPT || 1);
    const actor = env.GITHUB_TRIGGERING_ACTOR || null;
    const status = await statusOf(session, loginOf(pr), pr.author_association);
    const labels = labelNames(pr);
    const rerunByAPerson = runAttempt > 1 && Boolean(actor) && !actor.endsWith("[bot]");
    const actorDecides = status === "unknown" && !labels.includes(RUN_CI) && rerunByAPerson;
    decision = gateDecision({
      status,
      labels,
      runAttempt,
      actor,
      actorPermission: actorDecides ? await permissionOf(session, actor) : "none",
    });
  }
  core.setOutput("run", decision.run ? "true" : "false");
  core.info(decision.reason);
  if (!decision.run) await core.summary.addRaw(`## Build skipped\n\n${decision.reason}\n`).write();
  return decision;
}

module.exports = {
  TRUSTED,
  UNVOUCHED,
  DENOUNCED,
  RUN_CI,
  GATED_WORKFLOWS,
  LABEL_SPECS,
  loadRepoFiles,
  parseVouchedList,
  listStatus,
  authorStatus,
  labelForStatus,
  gateDecision,
  fillTemplate,
  run,
  listChanged,
  gate,
};
