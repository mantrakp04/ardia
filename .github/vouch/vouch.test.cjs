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
  unvouchedNote: "Hi @{author}, see {owner}/{repo} on {default_branch}.",
  denouncedNote: "Closed for @{author}.",
};

const WRITE_METHODS = new Set([
  "issues.addLabels",
  "issues.removeLabel",
  "issues.createLabel",
  "issues.createComment",
  "issues.update",
  "pulls.update",
  "actions.reRunWorkflow",
]);

function pr(number, login, { labels = [], state = "open", sha = `sha${number}`, association } = {}) {
  return {
    number,
    state,
    author_association: association,
    user: login === null ? null : { login },
    labels: labels.map((name) => ({ name })),
    head: { sha, ref: `branch${number}`, repo: { full_name: `fork${number}/ardia` } },
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
    },
    pulls: {
      list: record("pulls.list", () => ({ data: pulls })),
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
  const paginate = async (method, params) => (await method(params)).data;
  const writes = () => calls.filter((call) => WRITE_METHODS.has(call.name));
  const named = (name) => calls.filter((call) => call.name === name);
  return { rest, paginate, calls, writes, named };
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
  assert.deepEqual(github.named("issues.createLabel").map((call) => call.params.name), [vouch.UNVOUCHED, vouch.DENOUNCED, vouch.RUN_CI]);
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
