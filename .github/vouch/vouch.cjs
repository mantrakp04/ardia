const fs = require("node:fs");
const path = require("node:path");

const TRUSTED = "vouch:trusted";
const UNVOUCHED = "vouch:unvouched";
const DENOUNCED = "vouch:denounced";
const RUN_CI = "run-ci";
const VOUCH_LABELS = [TRUSTED, UNVOUCHED, DENOUNCED];
const NOT_A_BUG_FIX = "not-a-bug-fix";
const OVER_LIMIT = "over-limit";
const NEEDS_REBASE = "needs-rebase";
const READY = "ready";
const INCOMPLETE = "incomplete";
const RULE_LABELS = [NOT_A_BUG_FIX, OVER_LIMIT, NEEDS_REBASE, READY, INCOMPLETE];
const LABEL_SPECS = [
  { name: TRUSTED, color: "1f883d", description: "The author is a collaborator, a bot or vouched for" },
  { name: UNVOUCHED, color: "fbca04", description: "The author is not vouched for yet" },
  { name: DENOUNCED, color: "d1242f", description: "The author is denounced" },
  { name: RUN_CI, color: "0969da", description: "A maintainer started CI for this pull request" },
  { name: NOT_A_BUG_FIX, color: "e99695", description: "From outside the team we take bug fixes only, and no linked issue is labelled bug" },
  { name: OVER_LIMIT, color: "c5def5", description: "The author has more pull requests open than the limit, so this one waits" },
  { name: NEEDS_REBASE, color: "b60205", description: "This pull request conflicts with its base branch" },
  { name: READY, color: "0e8a16", description: "Meets every rule in CONTRIBUTING.md and waits for review" },
  { name: INCOMPLETE, color: "ededed", description: "Something in CONTRIBUTING.md is still missing" },
];
const RULES_START = "2026-11-14T11:00:00Z";
const OPEN_PR_LIMIT = 3;
const RULED_TIERS = ["outsider", "trusted"];
const BUG_LABEL = "bug";
const BUG_FIX_STATUS_CONTEXT = "bug-fix-only";
const BUG_FIX_DESCRIPTIONS = {
  failure: "From outside the team we take bug fixes only: no linked issue is labelled bug",
  outsider: "A linked issue is labelled bug",
  trusted: "Vouched contributors may send features as well as bug fixes",
};
const FAILED_CHECK_CONCLUSIONS = ["failure", "timed_out", "cancelled", "action_required", "error", "startup_failure"];
const KNOWN_MERGEABLE = ["MERGEABLE", "CONFLICTING"];
const MERGEABLE_SETTLE_ATTEMPTS = 3;
const RULES_PAGE_SIZE = 25;
const PULL_RULE_ACTIONS = ["edited", "synchronize", "ready_for_review", "converted_to_draft"];
const MEDIA_EXTENSIONS = "png|jpe?g|gif|webp|avif|heic|svg|bmp|mp4|mov|webm|m4v|mkv|avi";
const MEDIA_PATTERNS = [
  /!\[[^\]]*\]\([^)]+\)/,
  /<img\b/i,
  /<video\b/i,
  /github\.com\/user-attachments\/assets\//i,
  new RegExp(`https?:\\/\\/[^\\s<>()"'\\]]+\\.(?:${MEDIA_EXTENSIONS})(?:[?#][^\\s<>()"'\\]]*)?(?=$|[\\s<>()"'\\],;:!]|\\.(?:\\s|$))`, "i"),
];
const CLOSING_REFERENCE = /(?:^|[^A-Za-z0-9_])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?[^\S\n]+#(\d+)/gim;
const GATED_WORKFLOWS = ["ios.yml", "android.yml"];
const GATE_JOB = "gate";
const TRUSTED_STATUSES = ["bot", "team", "collaborator", "vouched"];
const WRITE_PERMISSIONS = ["admin", "write"];
const COLLABORATOR_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"];
const VOUCHED_LIST_PATH = ".github/VOUCHED.td";
const TEAM_LIST_PATH = ".github/TEAM.td";
const SWEEP_WRITE_INTERVAL_MS = 1000;
const RUN_SETTLE_INTERVAL_MS = 15000;
const RUN_SETTLE_ATTEMPTS = 6;
const REPO_ROOT = path.resolve(__dirname, "..", "..");

function loadRepoFiles(root = REPO_ROOT) {
  const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
  return {
    list: read(VOUCHED_LIST_PATH),
    team: read(TEAM_LIST_PATH),
    unvouchedNote: read(".github/vouch/pr-unvouched.md"),
    denouncedNote: read(".github/vouch/denounced.md"),
    overLimitNote: read(".github/vouch/pr-over-limit.md"),
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

function createdSinceRules(createdAt) {
  const time = Date.parse(createdAt || "");
  return Number.isFinite(time) && time >= Date.parse(RULES_START);
}

function ruleTier(status) {
  if (status === "bot" || status === "team" || status === "denounced") return status;
  if (status === "collaborator" || status === "vouched") return "trusted";
  return "outsider";
}

function hasMedia(body) {
  const text = String(body || "").replace(/<!--[\s\S]*?-->/g, "");
  return MEDIA_PATTERNS.some((pattern) => pattern.test(text));
}

function closingIssueNumbers(body) {
  const numbers = new Set();
  for (const match of String(body || "").matchAll(CLOSING_REFERENCE)) numbers.add(Number(match[1]));
  return [...numbers].sort((a, b) => a - b);
}

function openPositions(pulls) {
  const byAuthor = new Map();
  for (const pull of pulls) {
    const key = pull.login ? pull.login.toLowerCase() : `#${pull.number}`;
    if (!byAuthor.has(key)) byAuthor.set(key, []);
    byAuthor.get(key).push(pull);
  }
  const positions = new Map();
  for (const group of byAuthor.values()) {
    group
      .sort((a, b) => (Date.parse(a.createdAt) - Date.parse(b.createdAt)) || a.number - b.number)
      .forEach((pull, index) => positions.set(pull.number, index + 1));
  }
  return positions;
}

function isConflicting({ mergeable, labels }) {
  if (mergeable === "CONFLICTING") return true;
  if (mergeable === "MERGEABLE") return false;
  return (labels || []).includes(NEEDS_REBASE);
}

function hasFailedCheck(checks) {
  return (checks || []).some((check) => FAILED_CHECK_CONCLUSIONS.includes(String(check.conclusion || "").toLowerCase()));
}

function closesABug(linkedIssues) {
  return (linkedIssues || []).some((issue) =>
    (issue.labels || []).some((name) => String(name).toLowerCase() === BUG_LABEL),
  );
}

function ruleLabels(pull) {
  if (!RULED_TIERS.includes(pull.tier)) return null;
  if (String(pull.state || "").toLowerCase() !== "open" || !createdSinceRules(pull.createdAt)) return null;
  const outsider = pull.tier === "outsider";
  const wanted = new Set();
  if (outsider && !closesABug(pull.linkedIssues)) wanted.add(NOT_A_BUG_FIX);
  if (outsider && (pull.position || 1) > OPEN_PR_LIMIT) wanted.add(OVER_LIMIT);
  const conflicting = isConflicting(pull);
  if (conflicting) wanted.add(NEEDS_REBASE);
  const ready =
    !pull.draft &&
    hasMedia(pull.body) &&
    !(pull.reviewThreads || []).some((thread) => !thread.resolved && thread.startedByBot) &&
    !conflicting &&
    !wanted.has(NOT_A_BUG_FIX) &&
    !wanted.has(OVER_LIMIT) &&
    !hasFailedCheck(pull.checks);
  wanted.add(ready ? READY : INCOMPLETE);
  return RULE_LABELS.filter((name) => wanted.has(name));
}

function bugFixStatus(tier, rules) {
  if (!rules) return null;
  if (tier === "outsider" && rules.includes(NOT_A_BUG_FIX)) {
    return { state: "failure", description: BUG_FIX_DESCRIPTIONS.failure };
  }
  if (tier === "outsider") return { state: "success", description: BUG_FIX_DESCRIPTIONS.outsider };
  if (tier === "trusted") return { state: "success", description: BUG_FIX_DESCRIPTIONS.trusted };
  return null;
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
    team: new Set(
      [...parseVouchedList(loaded.team || "")].filter(([, entry]) => !entry.denounced).map(([login]) => login),
    ),
    permissions: new Map(),
    issues: new Map(),
    openPulls: null,
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
  if (session.team.has(login.toLowerCase())) return "team";
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

function payloadDefaultBranch(session) {
  return (session.context.payload.repository || {}).default_branch || "main";
}

function templateValues(session, login, defaultBranch = payloadDefaultBranch(session)) {
  return {
    author: login || "ghost",
    owner: session.repo.owner,
    repo: session.repo.repo,
    default_branch: defaultBranch,
  };
}

function contributingUrl(session, defaultBranch) {
  const { owner, repo } = session.repo;
  return `https://github.com/${owner}/${repo}/blob/${defaultBranch}/CONTRIBUTING.md#pull-requests`;
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
    return status;
  }
  if (label === UNVOUCHED && isNew) {
    await postOnce(session, pr.number, fillTemplate(session.files.unvouchedNote, templateValues(session, login)));
  }
  return status;
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

const RULE_PULL_FRAGMENT = `
fragment RulePull on PullRequest {
  number
  state
  isDraft
  createdAt
  body
  mergeable
  baseRefName
  headRefOid
  authorAssociation
  author { __typename login }
  labels(first: 100) { nodes { name } }
  closingIssuesReferences(first: 20) { nodes { number labels(first: 50) { nodes { name } } } }
  reviewThreads(last: 100) { nodes { isResolved comments(first: 1) { nodes { author { __typename login } } } } }
  commits(last: 1) {
    nodes {
      commit {
        oid
        status { context(name: "${BUG_FIX_STATUS_CONTEXT}") { state description targetUrl } }
        statusCheckRollup {
          contexts(first: 100) {
            nodes {
              __typename
              ... on CheckRun {
                name
                status
                conclusion
                startedAt
                checkSuite { app { slug } workflowRun { workflow { name } } }
              }
              ... on StatusContext { context state createdAt }
            }
          }
        }
      }
    }
  }
}`;

const RULE_PULL_QUERY = `
query VouchRulePull($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    defaultBranchRef { name }
    pullRequest(number: $number) { ...RulePull }
  }
}
${RULE_PULL_FRAGMENT}`;

const RULE_PULLS_QUERY = `
query VouchRulePulls($owner: String!, $repo: String!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    defaultBranchRef { name }
    pullRequests(states: OPEN, first: $first, after: $after, orderBy: { field: CREATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes { ...RulePull }
    }
  }
}
${RULE_PULL_FRAGMENT}`;

const MERGEABLE_QUERY = `
query VouchMergeable($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) { pullRequest(number: $number) { mergeable } }
}`;

const ISSUE_PULLS_QUERY = `
query VouchIssuePulls($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      closedByPullRequestsReferences(first: 50, includeClosedPrs: false) { nodes { number state createdAt } }
    }
  }
}`;

function nodesOf(connection) {
  return (connection && connection.nodes) || [];
}

function actorLogin(actor) {
  if (!actor || !actor.login) return null;
  return actor.__typename === "Bot" && !actor.login.endsWith("[bot]") ? `${actor.login}[bot]` : actor.login;
}

function latestChecks(checks) {
  const newest = new Map();
  const startedAt = (check) => (check.startedAt ? Date.parse(check.startedAt) : Infinity);
  for (const check of checks) {
    const held = newest.get(check.key);
    if (!held || startedAt(check) >= startedAt(held)) newest.set(check.key, check);
  }
  return [...newest.values()].map(({ name, conclusion }) => ({ name, conclusion }));
}

function rollupChecks(commit) {
  const contexts = nodesOf(commit && commit.statusCheckRollup && commit.statusCheckRollup.contexts);
  const ownStatus = (node) => node.__typename === "StatusContext" && node.context === BUG_FIX_STATUS_CONTEXT;
  return latestChecks(
    contexts.filter((node) => !ownStatus(node)).map((node) => {
      if (node.__typename === "StatusContext") {
        return { key: `status:${node.context}`, name: node.context, conclusion: node.state, startedAt: node.createdAt };
      }
      const suite = node.checkSuite || {};
      const workflow = suite.workflowRun && suite.workflowRun.workflow ? suite.workflowRun.workflow.name : null;
      const source = workflow || (suite.app ? suite.app.slug : "");
      return {
        key: `check:${source}/${node.name}`,
        name: node.name,
        conclusion: node.status === "COMPLETED" ? node.conclusion : null,
        startedAt: node.startedAt,
      };
    }),
  );
}

function pullFacts(node, defaultBranch) {
  const commit = (nodesOf(node.commits)[0] || {}).commit || null;
  const current = commit && commit.status ? commit.status.context : null;
  return {
    number: node.number,
    state: String(node.state || "").toLowerCase(),
    createdAt: node.createdAt,
    draft: Boolean(node.isDraft),
    body: node.body || "",
    mergeable: node.mergeable,
    baseRef: node.baseRefName,
    defaultBranch,
    headSha: (commit && commit.oid) || node.headRefOid,
    association: node.authorAssociation,
    login: actorLogin(node.author),
    labels: nodesOf(node.labels).map((label) => label.name),
    linkedIssues: nodesOf(node.closingIssuesReferences).map((issue) => ({
      number: issue.number,
      labels: nodesOf(issue.labels).map((label) => label.name),
    })),
    reviewThreads: nodesOf(node.reviewThreads).map((thread) => {
      const first = nodesOf(thread.comments)[0];
      return { resolved: Boolean(thread.isResolved), startedByBot: Boolean(first && first.author && first.author.__typename === "Bot") };
    }),
    checks: rollupChecks(commit),
    currentStatus: current
      ? { state: String(current.state || "").toLowerCase(), description: current.description || "", targetUrl: current.targetUrl || "" }
      : null,
  };
}

async function readRulePull(session, number) {
  const { github, repo } = session;
  const data = await github.graphql(RULE_PULL_QUERY, { owner: repo.owner, repo: repo.repo, number });
  const repository = (data && data.repository) || {};
  if (!repository.pullRequest) return null;
  const defaultBranch = (repository.defaultBranchRef || {}).name || payloadDefaultBranch(session);
  return pullFacts(repository.pullRequest, defaultBranch);
}

async function readNewRulePulls(session) {
  const { github, repo } = session;
  const found = [];
  let after = null;
  for (;;) {
    const data = await github.graphql(RULE_PULLS_QUERY, { owner: repo.owner, repo: repo.repo, first: RULES_PAGE_SIZE, after });
    const repository = data.repository;
    const defaultBranch = (repository.defaultBranchRef || {}).name || payloadDefaultBranch(session);
    const page = repository.pullRequests;
    let reachedOlder = false;
    for (const node of nodesOf(page)) {
      if (!createdSinceRules(node.createdAt)) {
        reachedOlder = true;
        continue;
      }
      found.push(pullFacts(node, defaultBranch));
    }
    if (reachedOlder || !page.pageInfo.hasNextPage) return found;
    after = page.pageInfo.endCursor;
  }
}

async function settleMergeable(session, facts) {
  const { github, repo } = session;
  let unknown = facts.filter((pull) => !KNOWN_MERGEABLE.includes(pull.mergeable));
  for (let attempt = 1; unknown.length && attempt <= MERGEABLE_SETTLE_ATTEMPTS; attempt += 1) {
    await session.settle();
    for (const pull of unknown) {
      const data = await github.graphql(MERGEABLE_QUERY, { owner: repo.owner, repo: repo.repo, number: pull.number });
      const found = data && data.repository && data.repository.pullRequest;
      if (found) pull.mergeable = found.mergeable;
    }
    unknown = unknown.filter((pull) => !KNOWN_MERGEABLE.includes(pull.mergeable));
  }
}

function issueLabelsOf(session, number) {
  if (!session.issues.has(number)) {
    const lookup = session.github.rest.issues
      .get({ ...session.repo, issue_number: number })
      .then(({ data }) => (data.pull_request ? null : { number, labels: labelNames(data) }), ignoreStatus(404, 410));
    session.issues.set(number, lookup);
  }
  return session.issues.get(number);
}

async function linkedIssuesOf(session, facts) {
  if (facts.linkedIssues.length || facts.baseRef === facts.defaultBranch) return facts.linkedIssues;
  const found = [];
  for (const number of closingIssueNumbers(facts.body)) {
    const issue = await issueLabelsOf(session, number);
    if (issue) found.push(issue);
  }
  return found;
}

async function tierOf(session, login, association) {
  return ruleTier(await statusOf(session, login, association));
}

async function openPullsOf(session) {
  if (!session.openPulls) {
    const { github, repo } = session;
    session.openPulls = github
      .paginate(github.rest.pulls.list, { ...repo, state: "open", per_page: 100 })
      .then((pulls) => pulls.filter((pull) => pull.state === "open").map(openPullEntry));
  }
  return session.openPulls;
}

function openPullEntry(pull) {
  return { number: pull.number, login: loginOf(pull), createdAt: pull.created_at };
}

async function positionOf(session, facts, { closed = null, opened = null } = {}) {
  let pulls = (await openPullsOf(session)).filter((pull) => pull.number !== closed);
  if (opened && !pulls.some((pull) => pull.number === opened.number)) pulls = [...pulls, opened];
  if (!pulls.some((pull) => pull.number === facts.number)) {
    pulls = [...pulls, { number: facts.number, login: facts.login, createdAt: facts.createdAt }];
  }
  const key = facts.login ? facts.login.toLowerCase() : null;
  const mine = pulls.filter((pull) => (key ? (pull.login || "").toLowerCase() === key : pull.number === facts.number));
  return openPositions(mine).get(facts.number);
}

function statusDiffers(current, wanted) {
  if (!current) return true;
  return current.state !== wanted.state || current.description !== wanted.description || current.targetUrl !== wanted.target_url;
}

async function planRules(session, facts, around) {
  if (facts.state !== "open" || !createdSinceRules(facts.createdAt)) return null;
  const tier = await tierOf(session, facts.login, facts.association);
  if (!RULED_TIERS.includes(tier)) return null;
  const position = tier === "outsider" ? await positionOf(session, facts, around) : 1;
  const linkedIssues = tier === "outsider" ? await linkedIssuesOf(session, facts) : facts.linkedIssues;
  const wanted = ruleLabels({ ...facts, tier, position, linkedIssues });
  const present = RULE_LABELS.filter((name) => facts.labels.includes(name));
  const add = wanted.filter((name) => !present.includes(name));
  const remove = present.filter((name) => !wanted.includes(name));
  const status = bugFixStatus(tier, wanted);
  const wantedStatus = status && { ...status, target_url: contributingUrl(session, facts.defaultBranch), context: BUG_FIX_STATUS_CONTEXT };
  const writeStatus =
    Boolean(wantedStatus) && Boolean(facts.headSha) && (tier === "outsider" || Boolean(facts.currentStatus)) &&
    statusDiffers(facts.currentStatus, wantedStatus);
  const note = add.includes(OVER_LIMIT);
  if (!add.length && !remove.length && !writeStatus) return null;
  const change = { number: facts.number, login: facts.login, tier, from: present, to: wanted, add, remove, status: writeStatus ? wantedStatus.state : null, note };
  return { facts, change, add, remove, note, wantedStatus: writeStatus ? wantedStatus : null };
}

async function latestPlan(session, facts, around) {
  const latest = await readRulePull(session, facts.number);
  if (!latest) return null;
  if (!KNOWN_MERGEABLE.includes(latest.mergeable)) latest.mergeable = facts.mergeable;
  return planRules(session, latest, around);
}

async function applyRules(session, given, { dryRun = false, around = {}, readAgain = false } = {}) {
  const { github, repo, core } = session;
  let plan = await planRules(session, given, around);
  if (plan && readAgain && !dryRun) plan = await latestPlan(session, given, around);
  if (!plan) return null;
  const { facts, change, add, remove, note, wantedStatus } = plan;
  const writeStatus = Boolean(wantedStatus);
  core.info(`${dryRun ? "Would change" : "Changing"} ${describeRuleChange(change)}`);
  if (dryRun) return change;
  if (add.length) {
    await ensureLabels(session);
    await write(session, () => github.rest.issues.addLabels({ ...repo, issue_number: facts.number, labels: add }));
  }
  for (const name of remove) {
    await write(session, () =>
      github.rest.issues.removeLabel({ ...repo, issue_number: facts.number, name }).catch(ignoreStatus(404)),
    );
  }
  if (writeStatus) {
    await write(session, () =>
      github.rest.repos.createCommitStatus({
        ...repo,
        sha: facts.headSha,
        state: wantedStatus.state,
        context: wantedStatus.context,
        description: wantedStatus.description.slice(0, 140),
        target_url: wantedStatus.target_url,
      }),
    );
  }
  if (note) {
    const values = { ...templateValues(session, facts.login, facts.defaultBranch), limit: OPEN_PR_LIMIT };
    await postOnce(session, facts.number, fillTemplate(session.files.overLimitNote, values));
  }
  return change;
}

async function evaluatePullRules(session, number, options = {}) {
  const facts = await readRulePull(session, number);
  if (!facts || facts.state !== "open" || !createdSinceRules(facts.createdAt)) return null;
  await settleMergeable(session, [facts]);
  return applyRules(session, facts, options);
}

async function evaluateAuthorRules(session, pull, { closed }) {
  const login = loginOf(pull);
  const changes = [];
  const opened = closed ? null : openPullEntry({ ...pull, state: "open" });
  const around = closed ? { closed: pull.number } : { opened };
  if (!closed && createdSinceRules(pull.created_at)) {
    const change = await evaluatePullRules(session, pull.number, { around });
    if (change) changes.push(change);
  }
  if (!login) return changes;
  const tier = await tierOf(session, login, pull.author_association);
  if (tier !== "outsider") return changes;
  const others = (await openPullsOf(session)).filter(
    (other) =>
      other.number !== pull.number &&
      (other.login || "").toLowerCase() === login.toLowerCase() &&
      createdSinceRules(other.createdAt),
  );
  for (const other of others) {
    const change = await evaluatePullRules(session, other.number, { around });
    if (change) changes.push(change);
  }
  return changes;
}

async function evaluateIssuePulls(session, issue) {
  const { github, repo } = session;
  const data = await github.graphql(ISSUE_PULLS_QUERY, { owner: repo.owner, repo: repo.repo, number: issue.number });
  const found = data && data.repository && data.repository.issue;
  const pulls = nodesOf(found && found.closedByPullRequestsReferences).filter(
    (pull) => String(pull.state).toUpperCase() === "OPEN" && createdSinceRules(pull.createdAt),
  );
  const changes = [];
  for (const pull of pulls) {
    const change = await evaluatePullRules(session, pull.number);
    if (change) changes.push(change);
  }
  return changes;
}

async function rulesPass(session, report, { dryRun }) {
  const facts = await readNewRulePulls(session);
  await settleMergeable(session, facts);
  for (const pull of facts) {
    const change = await applyRules(session, pull, { dryRun, readAgain: true });
    if (change) report.rules.push(change);
    const labels = change ? change.to : pull.labels;
    for (const name of RULE_LABELS) if (labels.includes(name)) report.ruleCounts[name] += 1;
  }
}

function describeRuleChange(change) {
  const parts = [
    ...change.add.map((name) => `+${name}`),
    ...change.remove.map((name) => `-${name}`),
    ...(change.status ? [`status ${change.status}`] : []),
    ...(change.note ? ["note"] : []),
  ];
  return `pull request #${change.number}: ${parts.join(" ")}`;
}

function describeChange(change) {
  return `${change.kind} #${change.number}: ${change.from.join(" + ") || "no label"} -> ${change.to}`;
}

function ruleSummaryLines(report) {
  return [
    `### Contribution rules (pull requests opened since ${RULES_START})`,
    "",
    "| Label | Pull requests |",
    "| --- | --- |",
    ...RULE_LABELS.map((label) => `| \`${label}\` | ${report.ruleCounts[label]} |`),
    "",
    report.rules.length
      ? `#### ${report.dryRun ? "Would change" : "Changed"} (${report.rules.length})`
      : "No rule changes.",
    ...report.rules.map((change) => `- ${describeRuleChange(change)}`),
  ];
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
    "",
    ...ruleSummaryLines(report),
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
    rules: [],
    ruleCounts: Object.fromEntries(RULE_LABELS.map((label) => [label, 0])),
  };
  const mayHaveWaitingBuild = [];
  const pulls = await github.paginate(github.rest.pulls.list, { ...repo, state: "all", per_page: 100 });
  session.openPulls = Promise.resolve(pulls.filter((pr) => pr.state === "open").map(openPullEntry));
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
  await rulesPass(session, report, { dryRun });
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
    const status = await handlePullRequest(session, payload.pull_request, { isNew: action === "opened" });
    if (status === "denounced") return null;
    return evaluateAuthorRules(session, payload.pull_request, { closed: false });
  }
  if (eventName === "pull_request_target" && action === "closed") {
    return evaluateAuthorRules(session, payload.pull_request, { closed: true });
  }
  if (eventName === "pull_request_target" && PULL_RULE_ACTIONS.includes(action)) {
    const pull = payload.pull_request;
    if (pull.state !== "open" || !createdSinceRules(pull.created_at)) return null;
    return evaluatePullRules(session, pull.number);
  }
  if (eventName === "issues" && (action === "opened" || action === "reopened")) {
    return handleIssue(session, payload.issue);
  }
  if (eventName === "issues" && (action === "labeled" || action === "unlabeled")) {
    const label = String((payload.label || {}).name || "").toLowerCase();
    if (label !== BUG_LABEL || !payload.issue || payload.issue.pull_request) return null;
    return evaluateIssuePulls(session, payload.issue);
  }
  if (eventName === "issue_comment" && isRecheck(payload)) {
    await handlePullRequest(session, payload.issue, { isNew: false });
    if (!createdSinceRules(payload.issue.created_at)) return null;
    return evaluatePullRules(session, payload.issue.number);
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
  NOT_A_BUG_FIX,
  OVER_LIMIT,
  NEEDS_REBASE,
  READY,
  INCOMPLETE,
  RULE_LABELS,
  RULES_START,
  OPEN_PR_LIMIT,
  BUG_FIX_STATUS_CONTEXT,
  loadRepoFiles,
  parseVouchedList,
  listStatus,
  authorStatus,
  labelForStatus,
  gateDecision,
  fillTemplate,
  ruleTier,
  ruleLabels,
  bugFixStatus,
  hasMedia,
  closingIssueNumbers,
  openPositions,
  latestChecks,
  run,
  listChanged,
  gate,
};
