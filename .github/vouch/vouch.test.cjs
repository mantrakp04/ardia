const test = require("node:test");
const assert = require("node:assert/strict");
const vouch = require("./vouch.cjs");

const FILES = {
  list: [
    "# maintainers vouch below",
    "",
    "Alice",
    "github:Bob",
    "-mallory spam and abuse",
    "-github:Eve",
    "  carol  ",
    "gitlab:dave",
  ].join("\n"),
  team: "shivamhwp\nmantrakp04\n",
  unvouchedNote: "Hi @{author}, see {owner}/{repo} on {default_branch}.",
  denouncedNote: "Closed for @{author}.",
  overLimitNote: "@{author}, more than {limit} open, see {owner}/{repo} on {default_branch}.",
};

const WRITE_METHODS = new Set([
  "issues.addLabels",
  "issues.removeLabel",
  "issues.createLabel",
  "issues.createComment",
  "issues.update",
  "pulls.update",
  "actions.reRunWorkflow",
  "repos.createCommitStatus",
]);

function pr(number, login, { labels = [], state = "open", sha = `sha${number}`, association, ...rules } = {}) {
  return {
    number,
    state,
    author_association: association,
    user: login === null ? null : { login },
    labels: labels.map((name) => ({ name })),
    head: { sha, ref: `branch${number}`, repo: { full_name: `fork${number}/ardia` } },
    created_at: rules.created_at,
    rules,
  };
}

const NEW = "2026-11-15T09:00:00Z";
const OLD = "2026-11-01T09:00:00Z";
const SHOT = "![shot](https://github.com/user-attachments/assets/0f3a)";

function fresh(number, login, options = {}) {
  return pr(number, login, {
    created_at: NEW,
    body: `Closes #100\n\n${SHOT}`,
    mergeable: "MERGEABLE",
    base: "main",
    linked: [100],
    ...options,
  });
}

function graphAuthor(login) {
  if (!login) return null;
  return login.endsWith("[bot]") ? { __typename: "Bot", login: login.slice(0, -5) } : { __typename: "User", login };
}

function graphNode(item, issues, mergeableOf) {
  const rules = item.rules || {};
  return {
    number: item.number,
    state: item.state.toUpperCase(),
    isDraft: Boolean(rules.draft),
    createdAt: rules.created_at || null,
    body: rules.body || "",
    mergeable: mergeableOf(item),
    baseRefName: rules.base || "main",
    headRefOid: item.head.sha,
    authorAssociation: item.author_association || "NONE",
    author: graphAuthor(item.user && item.user.login),
    labels: { nodes: item.labels },
    closingIssuesReferences: {
      nodes: (rules.linked || []).map((number) => {
        const issue = issues.find((candidate) => candidate.number === number);
        return { number, labels: { nodes: issue ? issue.labels : [] } };
      }),
    },
    reviewThreads: {
      nodes: (rules.threads || []).map((thread) => ({
        isResolved: Boolean(thread.resolved),
        comments: { nodes: [{ author: graphAuthor(thread.by) }] },
      })),
    },
    commits: {
      nodes: [
        {
          commit: {
            oid: item.head.sha,
            status: rules.bugFix ? { context: rules.bugFix } : null,
            statusCheckRollup: rules.checks ? { contexts: { nodes: rules.checks } } : null,
          },
        },
      ],
    },
  };
}

function runOf(number, id, status = "completed", conclusion = status === "completed" ? "success" : null) {
  return { id, status, conclusion, head_branch: `branch${number}`, head_repository: { full_name: `fork${number}/ardia` } };
}

const GATE_SKIPPED = [{ name: "gate", conclusion: "success" }, { name: "app", conclusion: "skipped" }];
const BUILT = [{ name: "gate", conclusion: "success" }, { name: "app", conclusion: "success" }];

function fakeGithub({
  permissions = {},
  pulls = [],
  issues = [],
  comments = {},
  repoLabels = vouch.LABEL_SPECS.map(({ name }) => ({ name })),
  runs = {},
  androidRuns = {},
  jobs = {},
  currentList = FILES.list,
  defaultBranch = "main",
} = {}) {
  const calls = [];
  const record = (name, handler) => async (params) => {
    calls.push({ name, params });
    return handler(params || {});
  };
  const notFound = () => Object.assign(new Error("Not Found"), { status: 404 });
  const rest = {
    repos: {
      getContent: record("repos.getContent", () => ({
        data: { content: Buffer.from(currentList).toString("base64"), encoding: "base64" },
      })),
      getCollaboratorPermissionLevel: record("repos.getCollaboratorPermissionLevel", ({ username }) => {
        const permission = permissions[username];
        if (!permission) throw notFound();
        return { data: { permission } };
      }),
      createCommitStatus: record("repos.createCommitStatus", () => ({ data: {} })),
    },
    pulls: {
      list: record("pulls.list", ({ state }) => ({
        data: state === "open" ? pulls.filter((item) => item.state === "open") : pulls,
      })),
      get: record("pulls.get", ({ pull_number }) => ({ data: pulls.find((item) => item.number === pull_number) })),
      update: record("pulls.update", () => ({ data: {} })),
    },
    issues: {
      listLabelsForRepo: record("issues.listLabelsForRepo", () => ({ data: repoLabels })),
      createLabel: record("issues.createLabel", () => ({ data: {} })),
      addLabels: record("issues.addLabels", () => ({ data: [] })),
      removeLabel: record("issues.removeLabel", () => ({ data: [] })),
      listComments: record("issues.listComments", ({ issue_number }) => ({ data: comments[issue_number] || [] })),
      createComment: record("issues.createComment", () => ({ data: {} })),
      update: record("issues.update", () => ({ data: {} })),
      get: record("issues.get", ({ issue_number }) => {
        const found = issues.find((issue) => issue.number === issue_number);
        if (!found) throw notFound();
        return { data: found };
      }),
      listForRepo: record("issues.listForRepo", ({ creator }) => ({
        data: issues.filter((issue) => issue.user && issue.user.login === creator && issue.state === "open"),
      })),
    },
    actions: {
      listWorkflowRuns: record("actions.listWorkflowRuns", ({ head_sha, workflow_id }) => {
        const found = (workflow_id === "ios.yml" ? runs : androidRuns)[head_sha] || [];
        return { data: { workflow_runs: typeof found === "function" ? found() : found } };
      }),
      listJobsForWorkflowRun: record("actions.listJobsForWorkflowRun", ({ run_id }) => ({ data: jobs[run_id] || [] })),
      reRunWorkflow: record("actions.reRunWorkflow", () => ({ data: {} })),
    },
  };
  const mergeableReads = {};
  const mergeableOf = (item) => {
    const answers = [].concat((item.rules || {}).mergeable || "MERGEABLE");
    const read = mergeableReads[item.number] || 0;
    mergeableReads[item.number] = read + 1;
    return answers[Math.min(read, answers.length - 1)];
  };
  const pullByNumber = (number) => pulls.find((item) => item.number === number);
  const graphql = async (query, variables) => {
    const operation = /query (\w+)/.exec(query)[1];
    calls.push({ name: `graphql.${operation}`, params: variables });
    const defaultBranchRef = { name: defaultBranch };
    if (operation === "VouchRulePull") {
      const item = pullByNumber(variables.number);
      return { repository: { defaultBranchRef, pullRequest: item ? graphNode(item, issues, mergeableOf) : null } };
    }
    if (operation === "VouchMergeable") {
      const item = pullByNumber(variables.number);
      return { repository: { pullRequest: item ? { mergeable: mergeableOf(item) } : null } };
    }
    if (operation === "VouchRulePulls") {
      const open = pulls
        .filter((item) => item.state === "open")
        .sort((a, b) => String(b.rules.created_at || "").localeCompare(String(a.rules.created_at || "")));
      const start = variables.after ? Number(variables.after) : 0;
      const page = open.slice(start, start + variables.first);
      const end = start + page.length;
      return {
        repository: {
          defaultBranchRef,
          pullRequests: {
            pageInfo: { hasNextPage: end < open.length, endCursor: String(end) },
            nodes: page.map((item) => graphNode(item, issues, mergeableOf)),
          },
        },
      };
    }
    if (operation === "VouchIssuePulls") {
      const nodes = pulls
        .filter((item) => (item.rules.linked || []).includes(variables.number))
        .map((item) => ({ number: item.number, state: item.state.toUpperCase(), createdAt: item.rules.created_at || null }));
      return { repository: { issue: { closedByPullRequestsReferences: { nodes } } } };
    }
    throw new Error(`Unexpected query ${operation}`);
  };
  const paginate = async (method, params) => (await method(params)).data;
  const writes = () => calls.filter((call) => WRITE_METHODS.has(call.name));
  const named = (name) => calls.filter((call) => call.name === name);
  return { rest, graphql, paginate, calls, writes, named };
}

function fakeCore() {
  const outputs = {};
  const summaries = [];
  const summary = {
    text: "",
    addRaw(text) {
      this.text += text;
      return this;
    },
    async write() {
      summaries.push(this.text);
      this.text = "";
      return this;
    },
  };
  return { outputs, summaries, summary, info() {}, warning() {}, setOutput: (key, value) => (outputs[key] = value) };
}

function context(eventName, payload = {}) {
  return {
    eventName,
    repo: { owner: "acme", repo: "ardia" },
    payload: { repository: { default_branch: "main" }, ...payload },
  };
}

async function invoke(entry, { github, eventName, payload, env = {} }) {
  const core = fakeCore();
  const result = await vouch[entry]({ github, context: context(eventName, payload), core, files: FILES, env, pace: async () => {}, settle: async () => {} });
  return { core, result };
}

test("the list parser handles plain names, the github prefix, denounced reasons, comments, blanks and case", () => {
  const list = vouch.parseVouchedList(FILES.list);
  assert.deepEqual([...list.keys()].sort(), ["alice", "bob", "carol", "eve", "mallory"]);
  assert.deepEqual(list.get("mallory"), { denounced: true, reason: "spam and abuse" });
  assert.deepEqual(list.get("eve"), { denounced: true, reason: null });
  assert.deepEqual(list.get("alice"), { denounced: false, reason: null });
  assert.equal(vouch.listStatus(list, "ALICE"), "vouched");
  assert.equal(vouch.listStatus(list, "dave"), "unknown");
});

test("status order: bot, then collaborator, then the list, then unknown", () => {
  const list = vouch.parseVouchedList(FILES.list);
  assert.equal(vouch.authorStatus({ list, login: "mallory[bot]", permission: "none" }), "bot");
  assert.equal(vouch.authorStatus({ list, login: "mallory", permission: "admin" }), "collaborator");
  assert.equal(vouch.authorStatus({ list, login: "mallory", permission: "write" }), "collaborator");
  assert.equal(vouch.authorStatus({ list, login: "Mallory", permission: "read" }), "denounced");
  assert.equal(vouch.authorStatus({ list, login: "alice", permission: "none" }), "vouched");
  assert.equal(vouch.authorStatus({ list, login: "stranger", permission: "read" }), "unknown");
  assert.equal(vouch.authorStatus({ list, login: null }), "unknown");
  assert.equal(vouch.labelForStatus("bot"), vouch.TRUSTED);
  assert.equal(vouch.labelForStatus("collaborator"), vouch.TRUSTED);
  assert.equal(vouch.labelForStatus("vouched"), vouch.TRUSTED);
  assert.equal(vouch.labelForStatus("unknown"), vouch.UNVOUCHED);
  assert.equal(vouch.labelForStatus("denounced"), vouch.DENOUNCED);
});

test("a new unvouched pull request gets the label and one filled note, and stays open", async () => {
  const github = fakeGithub();
  await invoke("run", { github, eventName: "pull_request_target", payload: { action: "opened", pull_request: pr(5, "stranger") } });
  assert.deepEqual(github.named("issues.addLabels").map((call) => call.params.labels), [[vouch.UNVOUCHED]]);
  const notes = github.named("issues.createComment");
  assert.equal(notes.length, 1);
  assert.equal(notes[0].params.body, "Hi @stranger, see acme/ardia on main.");
  assert.equal(github.named("pulls.update").length, 0);
});

test("the note is not posted twice when the same opened event runs again", async () => {
  const github = fakeGithub({ comments: { 5: [{ body: "Hi @stranger, see acme/ardia on main." }] } });
  await invoke("run", { github, eventName: "pull_request_target", payload: { action: "opened", pull_request: pr(5, "stranger") } });
  assert.equal(github.named("issues.createComment").length, 0);
});

test("reopen and /recheck label an unvouched pull request but post no note", async () => {
  const reopened = fakeGithub();
  await invoke("run", { github: reopened, eventName: "pull_request_target", payload: { action: "reopened", pull_request: pr(6, "stranger") } });
  const recheck = fakeGithub();
  await invoke("run", {
    github: recheck,
    eventName: "issue_comment",
    payload: { action: "created", comment: { body: " /recheck " }, issue: { ...pr(6, "stranger"), pull_request: {} } },
  });
  for (const github of [reopened, recheck]) {
    assert.deepEqual(github.named("issues.addLabels").map((call) => call.params.labels), [[vouch.UNVOUCHED]]);
    assert.equal(github.named("issues.createComment").length, 0);
  }
});

test("a deleted account's pull request is unvouched", async () => {
  const github = fakeGithub();
  await invoke("run", { github, eventName: "pull_request_target", payload: { action: "reopened", pull_request: pr(7, null) } });
  assert.deepEqual(github.named("issues.addLabels").map((call) => call.params.labels), [[vouch.UNVOUCHED]]);
  assert.equal(github.named("repos.getCollaboratorPermissionLevel").length, 0);
});

test("a denounced author's pull request is labelled, gets the line and is closed", async () => {
  const github = fakeGithub({ permissions: { mallory: "read" } });
  await invoke("run", { github, eventName: "pull_request_target", payload: { action: "opened", pull_request: pr(8, "mallory") } });
  assert.deepEqual(github.named("issues.addLabels").map((call) => call.params.labels), [[vouch.DENOUNCED]]);
  assert.deepEqual(github.named("issues.createComment").map((call) => call.params.body), ["Closed for @mallory."]);
  assert.deepEqual(github.named("pulls.update").map((call) => call.params), [{ owner: "acme", repo: "ardia", pull_number: 8, state: "closed" }]);
});

test("a denounced author's new issue is closed as not planned; anyone else's issue is untouched", async () => {
  const denounced = fakeGithub();
  await invoke("run", { github: denounced, eventName: "issues", payload: { action: "opened", issue: pr(9, "Eve") } });
  assert.deepEqual(denounced.named("issues.addLabels").map((call) => call.params.labels), [[vouch.DENOUNCED]]);
  assert.equal(denounced.named("issues.createComment").length, 1);
  assert.deepEqual(
    denounced.named("issues.update").map(({ params }) => [params.issue_number, params.state, params.state_reason]),
    [[9, "closed", "not_planned"]],
  );
  const normal = fakeGithub();
  await invoke("run", { github: normal, eventName: "issues", payload: { action: "opened", issue: pr(10, "stranger") } });
  assert.deepEqual(normal.calls, []);
});

test("missing vouch labels are created before the first add", async () => {
  const github = fakeGithub({ repoLabels: [{ name: "vouch:trusted" }] });
  await invoke("run", { github, eventName: "pull_request_target", payload: { action: "reopened", pull_request: pr(11, "alice") } });
  assert.deepEqual(github.named("issues.createLabel").map((call) => call.params.name), [
    vouch.UNVOUCHED,
    vouch.DENOUNCED,
    vouch.RUN_CI,
    ...vouch.RULE_LABELS,
  ]);
});

function sweepFixture() {
  return fakeGithub({
    permissions: { owner: "admin", mallory: "read" },
    pulls: [
      pr(1, "stranger"),
      pr(2, "alice", { labels: [vouch.UNVOUCHED] }),
      pr(3, "owner", { labels: [vouch.TRUSTED, vouch.UNVOUCHED, "bug"], state: "closed" }),
      pr(4, "dependabot[bot]", { labels: [vouch.TRUSTED] }),
      pr(5, "stranger", { labels: [vouch.UNVOUCHED] }),
      pr(6, "mallory"),
      pr(7, "mallory", { state: "closed", labels: [vouch.DENOUNCED] }),
    ],
    issues: [pr(20, "mallory"), pr(21, "mallory", { state: "closed" }), pr(22, "stranger")],
  });
}

test("the sweep fixes missing, wrong and double labels, closes denounced work and never posts the note", async () => {
  const github = sweepFixture();
  const { result, core } = await invoke("run", { github, eventName: "schedule" });
  const labelWrites = github.calls
    .filter((call) => call.name === "issues.addLabels" || call.name === "issues.removeLabel")
    .map(({ name, params }) => [name, params.issue_number, params.labels ? params.labels[0] : params.name]);
  assert.deepEqual(labelWrites, [
    ["issues.addLabels", 1, vouch.UNVOUCHED],
    ["issues.addLabels", 2, vouch.TRUSTED],
    ["issues.removeLabel", 2, vouch.UNVOUCHED],
    ["issues.removeLabel", 3, vouch.UNVOUCHED],
    ["issues.addLabels", 6, vouch.DENOUNCED],
    ["issues.addLabels", 20, vouch.DENOUNCED],
  ]);
  assert.ok(github.writes().every((call) => ![4, 5, 7].includes(call.params.issue_number ?? call.params.pull_number)));
  assert.deepEqual(github.named("issues.createComment").map((call) => [call.params.issue_number, call.params.body]), [
    [6, "Closed for @mallory."],
    [20, "Closed for @mallory."],
  ]);
  assert.deepEqual(github.named("pulls.update").map((call) => call.params.pull_number), [6]);
  assert.deepEqual(github.named("issues.update").map((call) => call.params.issue_number), [20]);
  assert.deepEqual(result.counts, { [vouch.TRUSTED]: 3, [vouch.UNVOUCHED]: 2, [vouch.DENOUNCED]: 2 });
  assert.equal(core.summaries.length, 1);
  assert.match(core.summaries[0], /pull request #2: vouch:unvouched -> vouch:trusted/);
});

test("the sweep leaves correctly labelled pull requests alone", async () => {
  const github = fakeGithub({
    permissions: { owner: "admin" },
    pulls: [pr(1, "owner", { labels: [vouch.TRUSTED] }), pr(2, "stranger", { labels: [vouch.UNVOUCHED, "bug"] })],
  });
  await invoke("run", { github, eventName: "schedule" });
  assert.deepEqual(github.writes(), []);
});

test("a dry-run sweep writes nothing but reports what it would do", async () => {
  const github = sweepFixture();
  const { result, core } = await invoke("run", { github, eventName: "workflow_dispatch", payload: { inputs: { dry_run: "true" } } });
  assert.deepEqual(github.writes(), []);
  assert.equal(github.named("issues.listLabelsForRepo").length, 0);
  assert.equal(result.changes.length, 5);
  assert.deepEqual(result.closed.map((item) => item.number), [6, 20]);
  assert.match(core.summaries[0], /dry run/);
});

test("an author GitHub reports as an outsider is never looked up; a collaborator is", async () => {
  const github = fakeGithub({
    permissions: { helper: "write" },
    pulls: [pr(1, "stranger", { association: "NONE" }), pr(2, "alice", { association: "CONTRIBUTOR" }), pr(3, "helper", { association: "COLLABORATOR" })],
  });
  const { result } = await invoke("run", { github, eventName: "workflow_dispatch", payload: { inputs: { dry_run: true } } });
  const looked = github.named("repos.getCollaboratorPermissionLevel").map((call) => call.params.username);
  assert.deepEqual(looked.filter((name) => ["stranger", "alice", "helper"].includes(name)), ["helper"]);
  assert.deepEqual(result.counts, { [vouch.TRUSTED]: 2, [vouch.UNVOUCHED]: 1, [vouch.DENOUNCED]: 0 });
});

test("nothing is closed for an author the default branch no longer denounces", async () => {
  const github = fakeGithub({
    currentList: "alice",
    permissions: { mallory: "read" },
    pulls: [pr(6, "mallory")],
    issues: [pr(20, "mallory")],
  });
  const { result } = await invoke("run", { github, eventName: "schedule" });
  assert.deepEqual(github.named("pulls.update"), []);
  assert.deepEqual(github.named("issues.update"), []);
  assert.deepEqual(github.named("issues.createComment"), []);
  assert.deepEqual(result.closed, []);
});

test("collaborator permission is looked up once per login", async () => {
  const github = fakeGithub({ pulls: [pr(1, "Stranger"), pr(2, "stranger"), pr(3, "STRANGER")] });
  await invoke("run", { github, eventName: "schedule" });
  const usernames = github.named("repos.getCollaboratorPermissionLevel").map((call) => call.params.username.toLowerCase());
  assert.deepEqual(usernames.sort(), ["eve", "mallory", "stranger"]);
});

function rerunFixture() {
  return fakeGithub({
    permissions: { owner: "admin" },
    pulls: [
      pr(1, "alice", { labels: [vouch.UNVOUCHED], sha: "a1" }),
      pr(2, "alice", { labels: [vouch.UNVOUCHED], sha: "a2", state: "closed" }),
      pr(3, "alice", { labels: [vouch.TRUSTED], sha: "a3" }),
      pr(4, "stranger", { sha: "s4" }),
      pr(5, "alice", { labels: [vouch.UNVOUCHED], sha: "a5" }),
      pr(6, "alice", { labels: [vouch.UNVOUCHED], sha: "a6" }),
      pr(7, "alice", { labels: [vouch.TRUSTED], sha: "a7" }),
      pr(8, "stranger", { labels: [vouch.UNVOUCHED, vouch.RUN_CI], sha: "s8" }),
      pr(9, "owner", { labels: [vouch.UNVOUCHED], sha: "o9" }),
      pr(10, "alice", { labels: [vouch.TRUSTED], sha: "a10" }),
      pr(11, "alice", { labels: [vouch.TRUSTED], sha: "shared" }),
      pr(12, "stranger", { labels: [vouch.UNVOUCHED], sha: "shared" }),
      pr(13, "alice", { labels: [vouch.TRUSTED], sha: "a13" }),
    ],
    runs: {
      a1: [runOf(1, 101), runOf(1, 100)],
      a2: [runOf(2, 200)],
      a3: [runOf(3, 300)],
      s4: [runOf(4, 400)],
      a5: [runOf(5, 500, "in_progress")],
      a6: [runOf(6, 600)],
      a7: [runOf(7, 700)],
      s8: [runOf(8, 800)],
      o9: [runOf(9, 900)],
      a10: [runOf(10, 1000)],
      shared: [runOf(12, 1200), runOf(11, 1100)],
      a13: [runOf(13, 1300, "completed", "cancelled")],
    },
    jobs: {
      101: GATE_SKIPPED,
      100: GATE_SKIPPED,
      200: GATE_SKIPPED,
      300: GATE_SKIPPED,
      400: GATE_SKIPPED,
      600: BUILT,
      700: [{ name: "gate", conclusion: "failure" }, { name: "app", conclusion: "skipped" }],
      800: GATE_SKIPPED,
      900: GATE_SKIPPED,
      1000: [{ name: "gate", conclusion: "cancelled" }, { name: "app", conclusion: "skipped" }],
      1100: GATE_SKIPPED,
      1200: GATE_SKIPPED,
      1300: [{ name: "gate", conclusion: "success" }, { name: "app", conclusion: "cancelled" }, { name: "packages", conclusion: "skipped" }],
    },
  });
}

const EXPECTED_RERUNS = [101, 300, 800, 900, 1100];

test("listChanged starts the waiting build of every open pull request that is now allowed to build", async () => {
  const github = rerunFixture();
  const { result, core } = await invoke("listChanged", { github, eventName: "issue_comment" });
  assert.deepEqual(github.named("actions.reRunWorkflow").map((call) => call.params.run_id), EXPECTED_RERUNS);
  assert.deepEqual(result.rerun.map((item) => item.number), [1, 3, 8, 9, 11]);
  const lookups = github.named("actions.listWorkflowRuns").map((call) => call.params);
  assert.ok(lookups.every((params) => vouch.GATED_WORKFLOWS.includes(params.workflow_id) && params.event === "pull_request"));
  for (const workflow of vouch.GATED_WORKFLOWS) {
    const shas = lookups.filter((params) => params.workflow_id === workflow).map((params) => params.head_sha);
    assert.deepEqual(shas, ["a1", "a3", "a5", "a6", "a7", "s8", "o9", "a10", "shared", "a13"], workflow);
  }
  assert.match(core.summaries[0], /Builds started \(5\)/);
});

test("a run that failed or was cancelled, at the gate or after it, is not started again", async () => {
  const github = rerunFixture();
  await invoke("listChanged", { github, eventName: "issue_comment" });
  const rerun = github.named("actions.reRunWorkflow").map((call) => call.params.run_id);
  assert.ok(!rerun.includes(700) && !rerun.includes(1000) && !rerun.includes(1300));
});

test("two pull requests on the same commit each get their own run", async () => {
  const github = rerunFixture();
  await invoke("listChanged", { github, eventName: "issue_comment" });
  const rerun = github.named("actions.reRunWorkflow").map((call) => call.params.run_id);
  assert.ok(rerun.includes(1100) && !rerun.includes(1200));
});

test("an author who gained write access gets a waiting build started", async () => {
  const github = rerunFixture();
  const { result } = await invoke("listChanged", { github, eventName: "issue_comment" });
  assert.ok(result.changes.some((change) => change.number === 9 && change.to === vouch.TRUSTED));
  assert.ok(github.named("actions.reRunWorkflow").some((call) => call.params.run_id === 900));
});

test("a push of the list and the daily sweep start waiting builds too; a dry run starts none", async () => {
  for (const eventName of ["push", "schedule"]) {
    const github = rerunFixture();
    await invoke("run", { github, eventName });
    assert.deepEqual(github.named("actions.reRunWorkflow").map((call) => call.params.run_id), EXPECTED_RERUNS, eventName);
  }
  const dry = rerunFixture();
  await invoke("run", { github: dry, eventName: "workflow_dispatch", payload: { inputs: { dry_run: "true" } } });
  assert.deepEqual(dry.named("actions.listWorkflowRuns"), []);
});

test("the run-ci label waits for a run that is still deciding, then starts its skipped build", async () => {
  const answers = [[runOf(9, 900, "in_progress")], [runOf(9, 900, "in_progress")], [runOf(9, 900)]];
  const github = fakeGithub({ runs: { s9: () => answers.shift() }, jobs: { 900: GATE_SKIPPED } });
  await invoke("run", {
    github,
    eventName: "pull_request_target",
    payload: { action: "labeled", label: { name: "run-ci" }, pull_request: pr(9, "stranger", { sha: "s9" }) },
  });
  assert.equal(github.named("actions.listWorkflowRuns").filter((call) => call.params.workflow_id === "ios.yml").length, 3);
  assert.deepEqual(github.named("actions.reRunWorkflow").map((call) => call.params.run_id), [900]);
});

test("the run-ci label re-runs the skipped build of every gated workflow", async () => {
  const github = fakeGithub({
    runs: { s9: [runOf(9, 900)] },
    androidRuns: { s9: [runOf(9, 950)] },
    jobs: { 900: GATE_SKIPPED, 950: GATE_SKIPPED },
  });
  await invoke("run", {
    github,
    eventName: "pull_request_target",
    payload: { action: "labeled", label: { name: "run-ci" }, pull_request: pr(9, "stranger", { sha: "s9" }) },
  });
  assert.deepEqual(github.named("actions.reRunWorkflow").map((call) => call.params.run_id), [900, 950]);
});

test("the run-ci label re-runs that pull request's skipped build; other labels do nothing", async () => {
  const github = fakeGithub({ runs: { s9: [runOf(9, 900)] }, jobs: { 900: GATE_SKIPPED } });
  await invoke("run", {
    github,
    eventName: "pull_request_target",
    payload: { action: "labeled", label: { name: "run-ci" }, pull_request: pr(9, "stranger", { sha: "s9" }) },
  });
  assert.deepEqual(github.named("actions.reRunWorkflow").map((call) => call.params.run_id), [900]);
  assert.deepEqual(github.named("issues.addLabels"), []);
  const other = fakeGithub({ runs: { s9: [runOf(9, 900)] }, jobs: { 900: GATE_SKIPPED } });
  await invoke("run", {
    github: other,
    eventName: "pull_request_target",
    payload: { action: "labeled", label: { name: "bug" }, pull_request: pr(9, "stranger", { sha: "s9" }) },
  });
  assert.deepEqual(other.calls, []);
});

async function gateFor({ author, labels = [], attempt = 1, actor, permissions = {}, github: given }) {
  const github = given || fakeGithub({ permissions, pulls: [pr(42, author, { labels })] });
  const { core, result } = await invoke("gate", {
    github,
    eventName: "pull_request",
    payload: { pull_request: pr(42, author) },
    env: { GITHUB_RUN_ATTEMPT: String(attempt), GITHUB_TRIGGERING_ACTOR: actor || author },
  });
  assert.equal(core.outputs.run, result.run ? "true" : "false");
  return { core, result };
}

test("the gate always passes on push", async () => {
  const github = fakeGithub();
  const { core } = await invoke("gate", { github, eventName: "push" });
  assert.equal(core.outputs.run, "true");
  assert.deepEqual(github.calls, []);
});

test("the gate passes trusted authors", async () => {
  for (const author of ["alice", "renovate[bot]", "owner"]) {
    const { result } = await gateFor({ author, permissions: { owner: "write" } });
    assert.equal(result.run, true, author);
  }
});

test("the gate skips an unvouched author and says how to start the build", async () => {
  const { result, core } = await gateFor({ author: "stranger" });
  assert.equal(result.run, false);
  assert.match(core.summaries[0], /run-ci/);
});

test("the gate passes an unvouched author's pull request labelled run-ci, read from the API", async () => {
  const { result } = await gateFor({ author: "stranger", labels: ["run-ci"] });
  assert.equal(result.run, true);
});

test("the gate passes a re-run started by a user with write or admin", async () => {
  for (const permission of ["write", "admin"]) {
    const { result } = await gateFor({ author: "stranger", attempt: 2, actor: "maint", permissions: { maint: permission } });
    assert.equal(result.run, true, permission);
  }
});

test("the gate skips a re-run by the unvouched author or by a user with read", async () => {
  const byAuthor = await gateFor({ author: "stranger", attempt: 2, actor: "stranger" });
  const byReader = await gateFor({ author: "stranger", attempt: 3, actor: "reader", permissions: { reader: "read" } });
  assert.equal(byAuthor.result.run, false);
  assert.equal(byReader.result.run, false);
});

test("the gate looks up the person who re-ran only when that decides the outcome", async () => {
  const cases = [
    { author: "alice", actor: "maint" },
    { author: "stranger", labels: ["run-ci"], actor: "maint" },
    { author: "stranger", actor: "github-actions[bot]" },
  ];
  for (const { author, labels = [], actor } of cases) {
    const github = fakeGithub({ permissions: { maint: "admin" }, pulls: [pr(42, author, { labels })] });
    await gateFor({ author, labels, attempt: 2, actor, github });
    const looked = github.named("repos.getCollaboratorPermissionLevel").map((call) => call.params.username);
    assert.ok(!looked.includes(actor), `${author} re-run by ${actor}`);
  }
});

test("the gate never passes a denounced author, even with run-ci or a maintainer re-run", async () => {
  const { result } = await gateFor({
    author: "mallory",
    labels: ["run-ci"],
    attempt: 2,
    actor: "maint",
    permissions: { mallory: "read", maint: "admin" },
  });
  assert.equal(result.run, false);
});

function facts(overrides = {}) {
  return {
    tier: "outsider",
    state: "open",
    createdAt: NEW,
    draft: false,
    body: SHOT,
    mergeable: "MERGEABLE",
    labels: [],
    linkedIssues: [{ number: 100, labels: ["bug"] }],
    position: 1,
    reviewThreads: [],
    checks: [],
    ...overrides,
  };
}

const { NOT_A_BUG_FIX, OVER_LIMIT, NEEDS_REBASE, READY, INCOMPLETE } = vouch;

test("rule decision: a complete bug fix from anyone outside the team is ready", () => {
  assert.deepEqual(vouch.ruleLabels(facts()), [READY]);
  assert.deepEqual(vouch.ruleLabels(facts({ tier: "trusted" })), [READY]);
  assert.deepEqual(vouch.ruleLabels(facts({ linkedIssues: [{ labels: ["Bug"] }, { labels: ["ui"] }] })), [READY]);
});

test("rule decision: the team, bots and denounced authors get no rule labels at all", () => {
  const broken = { draft: true, body: "", mergeable: "CONFLICTING", linkedIssues: [], position: 9 };
  for (const tier of ["team", "bot", "denounced"]) assert.equal(vouch.ruleLabels(facts({ ...broken, tier })), null, tier);
});

test("rule decision: before the cutover or once closed nothing is decided", () => {
  const broken = { draft: true, body: "", mergeable: "CONFLICTING", linkedIssues: [], position: 9 };
  assert.equal(vouch.ruleLabels(facts({ ...broken, createdAt: OLD })), null);
  assert.equal(vouch.ruleLabels(facts({ ...broken, createdAt: "2026-11-14T10:59:59Z" })), null);
  assert.equal(vouch.ruleLabels(facts({ ...broken, createdAt: undefined })), null);
  assert.deepEqual(vouch.ruleLabels(facts({ createdAt: vouch.RULES_START })), [READY]);
  assert.equal(vouch.ruleLabels(facts({ state: "closed" })), null);
});

test("rule decision: outsiders need a linked bug; trusted contributors may send features", () => {
  for (const linkedIssues of [[], [{ labels: [] }], [{ labels: ["enhancement"] }], undefined]) {
    assert.deepEqual(vouch.ruleLabels(facts({ linkedIssues })), [NOT_A_BUG_FIX, INCOMPLETE]);
    assert.deepEqual(vouch.ruleLabels(facts({ linkedIssues, tier: "trusted" })), [READY]);
  }
});

test("rule decision: an outsider's fourth open pull request is over the limit; trusted ones never are", () => {
  assert.equal(vouch.OPEN_PR_LIMIT, 3);
  assert.deepEqual(vouch.ruleLabels(facts({ position: 3 })), [READY]);
  assert.deepEqual(vouch.ruleLabels(facts({ position: 4 })), [OVER_LIMIT, INCOMPLETE]);
  assert.deepEqual(vouch.ruleLabels(facts({ position: 7, linkedIssues: [] })), [NOT_A_BUG_FIX, OVER_LIMIT, INCOMPLETE]);
  assert.deepEqual(vouch.ruleLabels(facts({ position: 7, tier: "trusted" })), [READY]);
});

test("rule decision: a conflict needs a rebase for every ruled tier; unknown keeps the current label", () => {
  for (const tier of ["outsider", "trusted"]) {
    assert.deepEqual(vouch.ruleLabels(facts({ tier, mergeable: "CONFLICTING" })), [NEEDS_REBASE, INCOMPLETE], tier);
    assert.deepEqual(vouch.ruleLabels(facts({ tier, mergeable: "MERGEABLE", labels: [NEEDS_REBASE] })), [READY], tier);
  }
  assert.deepEqual(vouch.ruleLabels(facts({ mergeable: "UNKNOWN", labels: [NEEDS_REBASE] })), [NEEDS_REBASE, INCOMPLETE]);
  assert.deepEqual(vouch.ruleLabels(facts({ mergeable: "UNKNOWN", labels: [] })), [READY]);
  assert.deepEqual(vouch.ruleLabels(facts({ mergeable: null, labels: [READY] })), [READY]);
});

test("rule decision: drafts, missing media and open bot review threads are incomplete", () => {
  for (const tier of ["outsider", "trusted"]) {
    assert.deepEqual(vouch.ruleLabels(facts({ tier, draft: true })), [INCOMPLETE]);
    assert.deepEqual(vouch.ruleLabels(facts({ tier, body: "Fixes the crash." })), [INCOMPLETE]);
    assert.deepEqual(vouch.ruleLabels(facts({ tier, reviewThreads: [{ resolved: false, startedByBot: true }] })), [INCOMPLETE]);
    assert.deepEqual(vouch.ruleLabels(facts({ tier, reviewThreads: [{ resolved: true, startedByBot: true }] })), [READY]);
    assert.deepEqual(vouch.ruleLabels(facts({ tier, reviewThreads: [{ resolved: false, startedByBot: false }] })), [READY]);
  }
});

test("rule decision: a finished failing check blocks ready; pending, passing and skipped ones do not", () => {
  for (const conclusion of ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "ERROR", "failure"]) {
    assert.deepEqual(vouch.ruleLabels(facts({ checks: [{ name: "app", conclusion }] })), [INCOMPLETE], conclusion);
  }
  for (const conclusion of [null, "SUCCESS", "SKIPPED", "NEUTRAL", "PENDING", "EXPECTED"]) {
    assert.deepEqual(vouch.ruleLabels(facts({ checks: [{ name: "app", conclusion }] })), [READY], String(conclusion));
  }
  assert.deepEqual(vouch.ruleLabels(facts({ checks: [{ name: vouch.BUG_FIX_STATUS_CONTEXT, conclusion: "FAILURE" }] })), [INCOMPLETE]);
});

test("rule decision: exactly one of ready and incomplete, always", () => {
  const variants = [
    {},
    { draft: true },
    { body: "" },
    { mergeable: "CONFLICTING" },
    { linkedIssues: [] },
    { position: 4 },
    { checks: [{ name: "x", conclusion: "FAILURE" }] },
    { reviewThreads: [{ resolved: false, startedByBot: true }] },
  ];
  for (const tier of ["outsider", "trusted"]) {
    for (const variant of variants) {
      const labels = vouch.ruleLabels(facts({ ...variant, tier }));
      assert.equal(labels.filter((name) => name === READY || name === INCOMPLETE).length, 1);
    }
  }
});

test("media in the description: images, videos, attachments and media links, not other links", () => {
  for (const body of [
    SHOT,
    "<img src=x>",
    "<video src=y></video>",
    "https://github.com/user-attachments/assets/1234-abcd",
    "see https://example.com/clip.MP4 here",
    "(https://i.imgur.com/a.png?raw=1)",
    "Before: https://example.com/before.gif. After: https://example.com/after.webm",
  ]) {
    assert.ok(vouch.hasMedia(body), body);
  }
  for (const body of ["", null, "https://example.com/page", "a png file", "<!-- ![x](y.png) -->", "https://example.com/a.pngx"]) {
    assert.ok(!vouch.hasMedia(body), String(body));
  }
});

test("closing references use linked-issue.yml's rule", () => {
  assert.deepEqual(vouch.closingIssueNumbers("Closes #12, fixes: #3\nResolved #12\nFIXED #40"), [3, 12, 40]);
  assert.deepEqual(vouch.closingIssueNumbers("prefixes #5 and closes#6 and refs #7 and fix\n#8"), []);
});

test("open positions are per author in creation order", () => {
  const positions = vouch.openPositions([
    { number: 9, login: "a", createdAt: "2026-11-15T03:00:00Z" },
    { number: 4, login: "A", createdAt: "2026-11-15T01:00:00Z" },
    { number: 7, login: "b", createdAt: "2026-11-15T00:00:00Z" },
    { number: 5, login: "a", createdAt: "2026-11-15T02:00:00Z" },
  ]);
  assert.deepEqual(Object.fromEntries(positions), { 4: 1, 5: 2, 9: 3, 7: 1 });
});

test("only the newest run of each check counts", () => {
  const checks = vouch.latestChecks([
    { key: "Linked issue/linked-issue", name: "linked-issue", conclusion: "FAILURE", startedAt: "2026-11-15T01:00:00Z" },
    { key: "Linked issue/linked-issue", name: "linked-issue", conclusion: "SUCCESS", startedAt: "2026-11-15T02:00:00Z" },
    { key: "Vouch/vouch", name: "vouch", conclusion: "CANCELLED", startedAt: "2026-11-15T01:00:00Z" },
    { key: "Vouch/vouch", name: "vouch", conclusion: null, startedAt: null },
  ]);
  assert.deepEqual(checks, [{ name: "linked-issue", conclusion: "SUCCESS" }, { name: "vouch", conclusion: null }]);
});

test("the bug-fix-only status: failure only for an outsider's non-bug-fix", () => {
  assert.equal(vouch.bugFixStatus("outsider", [NOT_A_BUG_FIX, INCOMPLETE]).state, "failure");
  assert.ok(vouch.bugFixStatus("outsider", [NOT_A_BUG_FIX]).description.length <= 140);
  assert.equal(vouch.bugFixStatus("outsider", [READY]).state, "success");
  assert.equal(vouch.bugFixStatus("trusted", [READY]).state, "success");
  assert.equal(vouch.bugFixStatus("outsider", null), null);
});

const BUG = pr(100, "reporter", { labels: ["bug"] });
const FEATURE = pr(101, "reporter", { labels: ["enhancement"] });

function ruleWrites(github) {
  return github.calls
    .filter((call) => ["issues.addLabels", "issues.removeLabel", "repos.createCommitStatus"].includes(call.name))
    .filter((call) => call.name !== "issues.addLabels" || !call.params.labels.some((name) => name.startsWith("vouch:")))
    .filter((call) => call.name !== "issues.removeLabel" || !call.params.name.startsWith("vouch:"))
    .map(({ name, params }) => {
      if (name === "repos.createCommitStatus") return ["status", params.sha, params.state];
      if (name === "issues.addLabels") return ["add", params.issue_number, ...params.labels];
      return ["remove", params.issue_number, params.name];
    });
}

async function event(github, action, pull, extra = {}) {
  const payload = { action, pull_request: { ...pull, created_at: pull.rules.created_at }, ...extra };
  return invoke("run", { github, eventName: "pull_request_target", payload });
}

test("a new outsider pull request that closes no bug gets the labels, a failing status and stays open", async () => {
  const pull = fresh(50, "stranger", { linked: [101] });
  const github = fakeGithub({ pulls: [pull], issues: [BUG, FEATURE] });
  await event(github, "opened", pull);
  assert.deepEqual(ruleWrites(github), [["add", 50, NOT_A_BUG_FIX, INCOMPLETE], ["status", "sha50", "failure"]]);
  const [status] = github.named("repos.createCommitStatus");
  assert.equal(status.params.context, "bug-fix-only");
  assert.equal(status.params.target_url, "https://github.com/acme/ardia/blob/main/CONTRIBUTING.md#pull-requests");
  assert.match(status.params.description, /bug fixes only/);
  assert.deepEqual(github.named("pulls.update"), []);
  assert.equal(github.named("issues.createComment").length, 1);
});

test("a complete outsider bug fix is ready with a passing status", async () => {
  const pull = fresh(51, "stranger");
  const github = fakeGithub({ pulls: [pull], issues: [BUG] });
  await event(github, "synchronize", pull);
  assert.deepEqual(ruleWrites(github), [["add", 51, READY], ["status", "sha51", "success"]]);
});

test("a pull request from before the cutover is never touched, even when it breaks every rule", async () => {
  const pull = pr(52, "stranger", {
    created_at: OLD,
    labels: [vouch.UNVOUCHED, READY],
    draft: true,
    mergeable: "CONFLICTING",
    linked: [],
    checks: [{ __typename: "CheckRun", name: "app", status: "COMPLETED", conclusion: "FAILURE" }],
  });
  const github = fakeGithub({ pulls: [pull] });
  for (const action of ["edited", "synchronize", "ready_for_review", "converted_to_draft", "reopened"]) {
    await event(github, action, pull);
  }
  await invoke("run", {
    github,
    eventName: "issue_comment",
    payload: { action: "created", comment: { body: "/recheck" }, issue: { ...pull, created_at: OLD, pull_request: {} } },
  });
  await invoke("run", { github, eventName: "schedule" });
  assert.deepEqual(ruleWrites(github), []);
  assert.deepEqual(github.named("graphql.VouchRulePull"), []);
});

test("old pull requests still count toward an author's open total", async () => {
  const old = [1, 2, 3].map((number) => pr(number, "stranger", { created_at: `2026-11-0${number}T00:00:00Z` }));
  const pull = fresh(60, "stranger");
  const github = fakeGithub({ pulls: [...old, pull], issues: [BUG] });
  await event(github, "opened", pull);
  assert.deepEqual(ruleWrites(github), [["add", 60, OVER_LIMIT, INCOMPLETE], ["status", "sha60", "success"]]);
});

test("the team and bots get no rule labels and no status, whatever they send", async () => {
  for (const login of ["shivamhwp", "MantraKP04", "renovate[bot]"]) {
    const pull = fresh(61, login, { linked: [], draft: true, mergeable: "CONFLICTING", body: "" });
    const github = fakeGithub({ pulls: [pull], permissions: { shivamhwp: "admin", MantraKP04: "write" } });
    await event(github, "opened", pull);
    await event(github, "edited", pull);
    await invoke("run", { github, eventName: "schedule" });
    assert.deepEqual(ruleWrites(github), [], login);
    assert.deepEqual(github.named("issues.createComment"), [], login);
  }
});

test("a denounced author's new pull request is closed as before and gets no rule labels", async () => {
  const pull = fresh(62, "mallory", { linked: [] });
  const github = fakeGithub({ permissions: { mallory: "read" }, pulls: [pull] });
  await event(github, "opened", pull);
  assert.deepEqual(github.named("pulls.update").map((call) => call.params.pull_number), [62]);
  assert.deepEqual(ruleWrites(github), []);
});

test("a trusted contributor's feature is fine, but a conflict still needs a rebase; no status is set", async () => {
  const feature = fresh(63, "alice", { linked: [101] });
  const conflicting = fresh(64, "alice", { linked: [], mergeable: "CONFLICTING" });
  const github = fakeGithub({ pulls: [feature, conflicting], issues: [FEATURE] });
  await event(github, "edited", feature);
  await event(github, "edited", conflicting);
  assert.deepEqual(ruleWrites(github), [["add", 63, READY], ["add", 64, NEEDS_REBASE, INCOMPLETE]]);
});

test("a vouched author's leftover failing status turns to success", async () => {
  const pull = fresh(65, "alice", {
    linked: [101],
    labels: [NOT_A_BUG_FIX, INCOMPLETE],
    bugFix: { state: "FAILURE", description: "old", targetUrl: "x" },
  });
  const github = fakeGithub({ pulls: [pull], issues: [FEATURE] });
  await event(github, "edited", pull);
  assert.deepEqual(ruleWrites(github), [
    ["add", 65, READY],
    ["remove", 65, NOT_A_BUG_FIX],
    ["remove", 65, INCOMPLETE],
    ["status", "sha65", "success"],
  ]);
});

function stranglerFixture({ commented = false } = {}) {
  const pulls = [1, 2, 3, 4].map((index) =>
    fresh(70 + index, "stranger", { created_at: `2026-11-15T0${index}:00:00Z`, labels: index === 4 ? [] : [READY] }),
  );
  const comments = commented ? { 74: [{ body: "@stranger, more than 3 open, see acme/ardia on main." }] } : {};
  return { pulls, github: fakeGithub({ pulls, issues: [BUG], comments }) };
}

test("the over-limit note is posted once, with the limit filled in", async () => {
  const { pulls, github } = stranglerFixture();
  await event(github, "opened", pulls[3]);
  const notes = github.named("issues.createComment").map((call) => [call.params.issue_number, call.params.body]);
  assert.deepEqual(notes, [
    [74, "Hi @stranger, see acme/ardia on main."],
    [74, "@stranger, more than 3 open, see acme/ardia on main."],
  ]);
  assert.ok(ruleWrites(github).some((write) => write[0] === "add" && write[1] === 74 && write.includes(OVER_LIMIT)));
  const again = stranglerFixture({ commented: true });
  await event(again.github, "reopened", again.pulls[3]);
  assert.deepEqual(again.github.named("issues.createComment"), []);
  const labelled = stranglerFixture();
  labelled.pulls[3].labels = [{ name: OVER_LIMIT }, { name: INCOMPLETE }, { name: vouch.UNVOUCHED }];
  await event(labelled.github, "synchronize", labelled.pulls[3]);
  assert.deepEqual(labelled.github.named("issues.createComment"), []);
  assert.deepEqual(ruleWrites(labelled.github), [["status", "sha74", "success"]]);
});

test("closing one pull request takes over-limit off the author's next one", async () => {
  const { pulls, github } = stranglerFixture();
  pulls[3].labels = [{ name: OVER_LIMIT }, { name: INCOMPLETE }];
  for (const pull of pulls.slice(0, 3)) pull.rules.bugFix = { state: "SUCCESS", description: "A linked issue is labelled bug", targetUrl: "https://github.com/acme/ardia/blob/main/CONTRIBUTING.md#pull-requests" };
  pulls[3].rules.bugFix = pulls[0].rules.bugFix;
  pulls[0].state = "closed";
  await event(github, "closed", pulls[0]);
  assert.deepEqual(ruleWrites(github), [["add", 74, READY], ["remove", 74, OVER_LIMIT], ["remove", 74, INCOMPLETE]]);
  assert.ok(github.named("graphql.VouchRulePull").every((call) => call.params.number !== 71));
});

test("reopening an old pull request pushes a newer one over the limit", async () => {
  const pulls = [
    pr(1, "stranger", { created_at: OLD }),
    fresh(2, "stranger", { created_at: "2026-11-15T01:00:00Z", labels: [READY] }),
    fresh(3, "stranger", { created_at: "2026-11-15T02:00:00Z", labels: [READY] }),
    fresh(4, "stranger", { created_at: "2026-11-15T03:00:00Z", labels: [READY] }),
  ];
  const github = fakeGithub({ pulls, issues: [BUG] });
  await event(github, "reopened", pulls[0]);
  assert.ok(ruleWrites(github).some((write) => write[0] === "add" && write[1] === 4 && write.includes(OVER_LIMIT)));
  assert.ok(!ruleWrites(github).some((write) => write[1] === 1));
});

test("the status is written only when it changes", async () => {
  const url = "https://github.com/acme/ardia/blob/main/CONTRIBUTING.md#pull-requests";
  const same = fresh(80, "stranger", {
    labels: [READY],
    bugFix: { state: "SUCCESS", description: "A linked issue is labelled bug", targetUrl: url },
  });
  const github = fakeGithub({ pulls: [same], issues: [BUG] });
  await event(github, "edited", same);
  assert.deepEqual(github.writes(), []);
  const stale = fresh(81, "stranger", { labels: [READY], bugFix: { state: "FAILURE", description: "x", targetUrl: url } });
  const other = fakeGithub({ pulls: [stale], issues: [BUG] });
  await event(other, "edited", stale);
  assert.deepEqual(ruleWrites(other), [["status", "sha81", "success"]]);
});

test("an unknown mergeable state is asked again, and when it stays unknown the label is kept", async () => {
  const settling = fresh(90, "stranger", { mergeable: ["UNKNOWN", "UNKNOWN", "CONFLICTING"] });
  const github = fakeGithub({ pulls: [settling], issues: [BUG] });
  await event(github, "synchronize", settling);
  assert.equal(github.named("graphql.VouchMergeable").length, 2);
  assert.deepEqual(ruleWrites(github)[0], ["add", 90, NEEDS_REBASE, INCOMPLETE]);
  const stuck = fresh(91, "stranger", { mergeable: "UNKNOWN", labels: [NEEDS_REBASE, INCOMPLETE] });
  const stuckGithub = fakeGithub({ pulls: [stuck], issues: [BUG] });
  await event(stuckGithub, "synchronize", stuck);
  assert.equal(stuckGithub.named("graphql.VouchMergeable").length, 3);
  assert.deepEqual(ruleWrites(stuckGithub), [["status", "sha91", "success"]]);
  const clean = fresh(92, "stranger", { mergeable: "UNKNOWN" });
  const cleanGithub = fakeGithub({ pulls: [clean], issues: [BUG] });
  await event(cleanGithub, "synchronize", clean);
  assert.deepEqual(ruleWrites(cleanGithub)[0], ["add", 92, READY]);
});

test("open bot review threads and failing head checks keep a pull request incomplete", async () => {
  const pull = fresh(93, "stranger", {
    threads: [{ by: "coderabbitai[bot]" }, { by: "alice" }],
    checks: [
      { __typename: "CheckRun", name: "linked-issue", status: "COMPLETED", conclusion: "FAILURE", startedAt: "2026-11-15T01:00:00Z", checkSuite: { workflowRun: { workflow: { name: "Linked issue" } } } },
      { __typename: "CheckRun", name: "linked-issue", status: "COMPLETED", conclusion: "SUCCESS", startedAt: "2026-11-15T02:00:00Z", checkSuite: { workflowRun: { workflow: { name: "Linked issue" } } } },
      { __typename: "CheckRun", name: "app", status: "IN_PROGRESS", conclusion: null, startedAt: "2026-11-15T02:00:00Z" },
    ],
  });
  const github = fakeGithub({ pulls: [pull], issues: [BUG] });
  await event(github, "edited", pull);
  assert.deepEqual(ruleWrites(github)[0], ["add", 93, INCOMPLETE]);
  pull.rules.threads = [{ by: "coderabbitai[bot]", resolved: true }];
  const again = fakeGithub({ pulls: [pull], issues: [BUG] });
  await event(again, "edited", pull);
  assert.deepEqual(ruleWrites(again)[0], ["add", 93, READY]);
  pull.rules.checks.push({ __typename: "StatusContext", context: "ci/legacy", state: "ERROR", createdAt: "2026-11-15T02:00:00Z" });
  const failed = fakeGithub({ pulls: [pull], issues: [BUG] });
  await event(failed, "edited", pull);
  assert.deepEqual(ruleWrites(failed)[0], ["add", 93, INCOMPLETE]);
});

test("on a base other than the default branch, the description's closing references are read", async () => {
  const pull = fresh(94, "stranger", { base: "release", linked: [], body: `Fixes #100, closes #7\n${SHOT}` });
  const issues = [BUG, { ...pr(7, "x"), pull_request: {}, labels: [{ name: "bug" }] }];
  const github = fakeGithub({ pulls: [pull], issues });
  await event(github, "edited", pull);
  assert.deepEqual(ruleWrites(github)[0], ["add", 94, READY]);
  const notABug = fresh(95, "stranger", { base: "release", linked: [], body: `Fixes #7\n${SHOT}` });
  const other = fakeGithub({ pulls: [notABug], issues });
  await event(other, "edited", notABug);
  assert.deepEqual(ruleWrites(other)[0], ["add", 95, NOT_A_BUG_FIX, INCOMPLETE]);
  const onMain = fresh(96, "stranger", { linked: [], body: `Fixes #100\n${SHOT}` });
  const main = fakeGithub({ pulls: [onMain], issues });
  await event(main, "edited", onMain);
  assert.deepEqual(ruleWrites(main)[0], ["add", 96, NOT_A_BUG_FIX, INCOMPLETE]);
  assert.deepEqual(main.named("issues.get"), []);
});

test("labelling an issue bug re-evaluates the open pull requests that close it", async () => {
  const issue = pr(100, "reporter", { labels: ["bug"] });
  const linked = fresh(97, "stranger", { linked: [100], labels: [NOT_A_BUG_FIX, INCOMPLETE] });
  const closed = fresh(98, "stranger", { linked: [100], state: "closed", labels: [NOT_A_BUG_FIX] });
  const old = pr(99, "stranger", { created_at: OLD, linked: [100], labels: [INCOMPLETE] });
  const github = fakeGithub({ pulls: [linked, closed, old], issues: [issue] });
  await invoke("run", { github, eventName: "issues", payload: { action: "labeled", label: { name: "bug" }, issue } });
  assert.deepEqual(ruleWrites(github), [
    ["add", 97, READY],
    ["remove", 97, NOT_A_BUG_FIX],
    ["remove", 97, INCOMPLETE],
    ["status", "sha97", "success"],
  ]);
  const unlabel = fakeGithub({ pulls: [fresh(97, "stranger", { linked: [100], labels: [READY] })], issues: [pr(100, "reporter")] });
  await invoke("run", { github: unlabel, eventName: "issues", payload: { action: "unlabeled", label: { name: "Bug" }, issue: pr(100, "reporter") } });
  assert.deepEqual(ruleWrites(unlabel), [["add", 97, NOT_A_BUG_FIX, INCOMPLETE], ["remove", 97, READY], ["status", "sha97", "failure"]]);
  const otherLabel = fakeGithub({ pulls: [linked], issues: [issue] });
  await invoke("run", { github: otherLabel, eventName: "issues", payload: { action: "labeled", label: { name: "ui" }, issue } });
  assert.deepEqual(otherLabel.calls, []);
});

test("/recheck evaluates the rules of that pull request", async () => {
  const pull = fresh(110, "stranger", { linked: [], labels: [vouch.UNVOUCHED] });
  const github = fakeGithub({ pulls: [pull] });
  await invoke("run", {
    github,
    eventName: "issue_comment",
    payload: { action: "created", comment: { body: "/recheck" }, issue: { ...pull, created_at: NEW, pull_request: {} } },
  });
  assert.deepEqual(ruleWrites(github), [["add", 110, NOT_A_BUG_FIX, INCOMPLETE], ["status", "sha110", "failure"]]);
});

function ruleSweepFixture() {
  const pulls = [];
  for (let index = 0; index < 30; index += 1) {
    const created = new Date(Date.parse(NEW) + index * 60000).toISOString();
    pulls.push(fresh(200 + index, `person${index}`, { created_at: created, labels: [READY] }));
  }
  pulls.push(fresh(300, "stranger", { linked: [] }));
  pulls.push(pr(301, "stranger", { created_at: OLD, linked: [], labels: [READY] }));
  pulls.push(fresh(302, "stranger", { state: "closed", linked: [] }));
  return fakeGithub({ pulls, issues: [BUG] });
}

test("the sweep pages through new open pull requests 25 at a time and fixes their rule labels", async () => {
  const github = ruleSweepFixture();
  const { result, core } = await invoke("run", { github, eventName: "schedule" });
  const pages = github.named("graphql.VouchRulePulls");
  assert.deepEqual(pages.map((call) => [call.params.first, call.params.after]), [[25, null], [25, "25"]]);
  const touched = new Set(ruleWrites(github).map((write) => write[1]));
  assert.ok(touched.has(300) && !touched.has(301) && !touched.has(302));
  assert.deepEqual(result.rules.find((change) => change.number === 300).add, [NOT_A_BUG_FIX, INCOMPLETE]);
  assert.match(core.summaries[0], /pull request #300: \+not-a-bug-fix \+incomplete status failure/);
  assert.match(core.summaries[0], /\| `ready` \| 30 \|/);
});

test("a dry-run sweep writes no rule labels, statuses or notes but reports them", async () => {
  const github = ruleSweepFixture();
  const { result, core } = await invoke("run", { github, eventName: "workflow_dispatch", payload: { inputs: { dry_run: "true" } } });
  assert.deepEqual(github.writes(), []);
  assert.equal(github.named("issues.listComments").length, 0);
  assert.ok(result.rules.length >= 31);
  assert.match(core.summaries[0], /Would change \(\d+\)/);
});

test("the sweep never strips hand-applied labels from old pull requests", async () => {
  const github = fakeGithub({
    pulls: [pr(400, "stranger", { created_at: OLD, labels: [vouch.UNVOUCHED, READY, INCOMPLETE], mergeable: "CONFLICTING" })],
  });
  await invoke("run", { github, eventName: "schedule" });
  assert.deepEqual(github.writes(), []);
});

test("listChanged, run by the vouch command, checks the rules in the same run", async () => {
  const github = ruleSweepFixture();
  const { result } = await invoke("listChanged", { github, eventName: "issue_comment" });
  assert.ok(github.named("graphql.VouchRulePulls").length > 0);
  assert.ok(result.rules.length > 0);
});

test("our own stale bug-fix-only status never blocks ready, but a check run with that name does", async () => {
  const stale = { __typename: "StatusContext", context: "bug-fix-only", state: "FAILURE", createdAt: "2026-11-15T02:00:00Z" };
  const pull = fresh(95, "stranger", { checks: [stale], bugFix: { state: "FAILURE", description: "old", targetUrl: "" } });
  const github = fakeGithub({ pulls: [pull], issues: [BUG] });
  await event(github, "edited", pull);
  assert.deepEqual(ruleWrites(github), [["add", 95, READY], ["status", "sha95", "success"]]);
  const lookalike = { __typename: "CheckRun", name: "bug-fix-only", status: "COMPLETED", conclusion: "FAILURE", startedAt: "2026-11-15T02:00:00Z" };
  const other = fresh(96, "stranger", { checks: [lookalike] });
  const second = fakeGithub({ pulls: [other], issues: [BUG] });
  await event(second, "edited", other);
  assert.deepEqual(ruleWrites(second)[0], ["add", 96, INCOMPLETE]);
});

test("a team member with no write access is trusted: no note, and the gate lets the build run", async () => {
  const pull = fresh(97, "shivamhwp", { linked: [] });
  const github = fakeGithub({ pulls: [pull] });
  await event(github, "opened", pull);
  assert.deepEqual(github.named("issues.addLabels").map((call) => call.params.labels), [[vouch.TRUSTED]]);
  assert.deepEqual(github.named("issues.createComment"), []);
  const { result } = await gateFor({ author: "shivamhwp" });
  assert.equal(result.run, true);
});

test("the sweep reads a pull request again before it writes, so a change made meanwhile wins", async () => {
  const pull = fresh(98, "stranger", { linked: [101] });
  const issues = [BUG, { ...FEATURE, labels: [...FEATURE.labels] }];
  const github = fakeGithub({ pulls: [pull], issues });
  const graphql = github.graphql;
  github.graphql = async (query, variables) => {
    const answer = await graphql(query, variables);
    if (/query VouchRulePulls/.test(query)) issues[1].labels.push({ name: "bug" });
    return answer;
  };
  await invoke("run", { github, eventName: "schedule" });
  assert.equal(github.named("graphql.VouchRulePull").length, 1);
  assert.deepEqual(ruleWrites(github), [["add", 98, READY], ["status", "sha98", "success"]]);
});
