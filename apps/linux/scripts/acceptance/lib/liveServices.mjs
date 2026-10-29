import { fixtureSecret } from "./fixtureSecrets.mjs";

export const LIVE_HOSTS = ["api.github.com", "github.com", "api.bitbucket.org", "api.notion.com", "acme.atlassian.net", "oauth2.googleapis.com", "www.googleapis.com", "accounts.google.com"];

export const LIVE_FIXTURE = {
  github: { token: fixtureSecret("ghp_"), deviceToken: fixtureSecret("ghp_"), clientId: "Iv1.fixture", login: "octo-fixture" },
  bitbucket: { user: "alice-fixture", token: fixtureSecret("ATBB"), accountId: "557058:fixture-account" },
  notion: { token: fixtureSecret("secret_"), altToken: fixtureSecret("secret_"), workspace: "Fixture Workspace" },
  confluence: { site: "https://acme.atlassian.net", email: "alice@fixture.test", token: fixtureSecret("ATATT"), accountId: "fixture-confluence-id" },
  gdrive: { clientId: "fixture.apps.googleusercontent.com", clientSecret: fixtureSecret("GOCSPX-"), code: fixtureSecret("4/"), refreshToken: fixtureSecret("1//"), email: "alice@fixture.test" },
};

const SECRET_VALUES = () => [
  LIVE_FIXTURE.github.token,
  LIVE_FIXTURE.github.deviceToken,
  LIVE_FIXTURE.bitbucket.token,
  LIVE_FIXTURE.notion.token,
  LIVE_FIXTURE.notion.altToken,
  LIVE_FIXTURE.confluence.token,
  LIVE_FIXTURE.gdrive.clientSecret,
  LIVE_FIXTURE.gdrive.refreshToken,
];

export const liveSecretValues = SECRET_VALUES;

const basic = (user, secret) => `Basic ${Buffer.from(`${user}:${secret}`).toString("base64")}`;

const pr = (id, number, title, repo = "fixture/app", head = `feature-${number}`, base = "main") => ({
  id,
  state: "OPEN",
  number,
  title,
  url: `https://github.com/${repo}/pull/${number}`,
  isDraft: false,
  updatedAt: "2026-10-27T10:00:00Z",
  createdAt: "2026-10-26T10:00:00Z",
  headRefName: head,
  baseRefName: base,
  mergeable: "MERGEABLE",
  reviewDecision: "REVIEW_REQUIRED",
  additions: 10,
  deletions: 2,
  changedFiles: 3,
  repository: { nameWithOwner: repo },
  author: { login: LIVE_FIXTURE.github.login, avatarUrl: "https://avatars.githubusercontent.com/u/1" },
  comments: { totalCount: 1 },
  reviewThreads: { nodes: [{ isResolved: false }] },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS", contexts: { nodes: [{ __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: null }] } } } }] },
});

export function createLiveServices() {
  const state = {
    githubTokens: new Set([LIVE_FIXTURE.github.token]),
    githubPulls: [pr("PR_open1", 11, "Fixture pull request one"), pr("PR_open2", 12, "Fixture pull request two")],
    githubGone: {},
    githubSso: false,
    rateLimited: new Set(),
    devicePolls: 0,
    deviceScript: ["authorization_pending", "slow_down", "token"],
    bitbucketPulls: [{ id: 7, title: "Fixture Bitbucket change", state: "OPEN" }],
    bitbucketGone: {},
    notionPages: [{ object: "page", id: "notion-page-1", url: "https://www.notion.so/notion-page-1", last_edited_time: "2026-10-27T09:00:00Z", last_edited_by: { id: "u1" }, icon: { type: "emoji", emoji: "📄" }, properties: { Name: { type: "title", title: [{ plain_text: "Fixture Notion page" }] } } }],
    confluencePages: [{ id: "c1", type: "page", title: "Fixture Confluence page", space: { key: "FX", name: "Fixture Space" }, history: { lastUpdated: { when: "2026-10-27T08:00:00Z", by: { displayName: "Alice" } } }, _links: { webui: "/spaces/FX/pages/c1" } }],
    driveFiles: [{ id: "d1", name: "Fixture Drive doc", mimeType: "application/vnd.google-apps.document", webViewLink: "https://docs.google.com/document/d/d1", modifiedTime: "2026-10-27T07:00:00Z", lastModifyingUser: { displayName: "Alice" } }],
    googleAccess: new Set(),
    googleRefreshValid: true,
    googleIssued: 0,
    googleRenewals: 0,
    googleRenewDelayMs: 0,
    googleIssuedBy: {},
    googleCodes: new Set([LIVE_FIXTURE.gdrive.code]),
    delayMs: new Map(),
    offline: false,
    active: new Map(),
    maxActive: new Map(),
    requests: [],
  };

  const json = (res, status, body, headers = {}) => {
    const text = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text), ...headers });
    res.end(text);
  };
  const unauthorized = (res) => json(res, 401, { message: "Bad credentials" });
  const issueGoogle = (grant) => {
    const token = `ya29.fixture-${++state.googleIssued}`;
    state.googleAccess.add(token);
    state.googleIssuedBy[token] = grant;
    return token;
  };

  function github(req, res, url, body) {
    if (req.headers.host === "github.com") {
      if (url.pathname === "/login/device/code" && req.method === "POST") {
        const form = new URLSearchParams(body);
        if (form.get("client_id") !== LIVE_FIXTURE.github.clientId) return json(res, 200, { error: "incorrect_client_credentials" });
        state.devicePolls = 0;
        return json(res, 200, { device_code: "fixture-device", user_code: "FIXT-0001", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 1 });
      }
      if (url.pathname === "/login/oauth/access_token" && req.method === "POST") {
        const form = new URLSearchParams(body);
        if (form.get("device_code") !== "fixture-device" || form.get("grant_type") !== "urn:ietf:params:oauth:grant-type:device_code") return json(res, 200, { error: "bad_verification_code" });
        const step = state.deviceScript[Math.min(state.devicePolls++, state.deviceScript.length - 1)];
        if (step === "token") {
          state.githubTokens.add(LIVE_FIXTURE.github.deviceToken);
          return json(res, 200, { access_token: LIVE_FIXTURE.github.deviceToken, token_type: "bearer", scope: "repo,read:org" });
        }
        return json(res, 200, step === "slow_down" ? { error: "slow_down", interval: 1 } : { error: step });
      }
      return false;
    }
    if (url.pathname !== "/graphql" || req.method !== "POST") return false;
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (!state.githubTokens.has(token)) return unauthorized(res);
    if (state.githubSso) return json(res, 403, { message: "SSO" }, { "x-github-sso": "required; url=https://github.com/orgs/fixture/sso" });
    if (state.rateLimited.has("github")) return json(res, 403, { message: "rate" }, { "x-ratelimit-remaining": "0" });
    const { query, variables } = JSON.parse(body);
    const viewer = { login: LIVE_FIXTURE.github.login, name: "Octo Fixture", avatarUrl: "https://avatars.githubusercontent.com/u/1" };
    if (query.includes("LiveFolderDetails")) {
      return json(res, 200, { data: { nodes: variables.ids.map((id) => state.githubPulls.find((p) => p.id === id) ?? null) } });
    }
    if (query.includes("LiveFolderGone")) {
      return json(res, 200, { data: { nodes: variables.ids.map((id) => ({ id, state: state.githubGone[id] ?? "OPEN" })) } });
    }
    if (query.includes("LiveFolder")) {
      const ids = state.githubPulls.map((p) => ({ id: p.id }));
      return json(res, 200, { data: { viewer, authored: { nodes: ids }, review: { nodes: [] }, direct: { nodes: [] } } });
    }
    if (query.includes("viewer")) return json(res, 200, { data: { viewer } });
    return json(res, 200, { errors: [{ message: "Unknown fixture query" }] });
  }

  function bitbucket(req, res, url) {
    if (req.headers.authorization !== basic(LIVE_FIXTURE.bitbucket.user, LIVE_FIXTURE.bitbucket.token)) return unauthorized(res);
    if (state.rateLimited.has("bitbucket")) return json(res, 429, { error: { message: "rate" } });
    const path = url.pathname.replace(/^\/2\.0/, "");
    if (path === "/user") return json(res, 200, { account_id: LIVE_FIXTURE.bitbucket.accountId, display_name: "Alice Fixture", links: { avatar: { href: "https://bitbucket.org/avatar.png" } } });
    if (path === `/pullrequests/${encodeURIComponent(LIVE_FIXTURE.bitbucket.accountId)}` && url.searchParams.get("state") === "OPEN") {
      return json(res, 200, {
        values: state.bitbucketPulls.filter((p) => p.state === "OPEN").map((p) => ({
          id: p.id,
          title: p.title,
          updated_on: "2026-10-27T06:00:00Z",
          comment_count: 0,
          author: { display_name: "Alice Fixture" },
          source: { branch: { name: `bb-${p.id}` } },
          destination: { branch: { name: "main" }, repository: { full_name: "fixture/service" } },
          links: { html: { href: `https://bitbucket.org/fixture/service/pull-requests/${p.id}` } },
          participants: [],
        })),
      });
    }
    const match = path.match(/^\/repositories\/fixture\/service\/pullrequests\/(\d+)(\/statuses)?$/);
    if (match) {
      const pull = state.bitbucketPulls.find((p) => p.id === Number(match[1]));
      if (!pull) return json(res, 404, { error: { message: "not found" } });
      if (match[2]) return json(res, 200, { values: [{ state: "SUCCESSFUL", name: "pipeline", url: "https://bitbucket.org/ci" }] });
      return json(res, 200, { state: state.bitbucketGone[pull.id] ?? pull.state });
    }
    return json(res, 404, { error: { message: "unknown fixture path" } });
  }

  function notion(req, res, url) {
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (token !== LIVE_FIXTURE.notion.token && token !== LIVE_FIXTURE.notion.altToken) return unauthorized(res);
    if (req.headers["notion-version"] !== "2022-06-28") return json(res, 400, { message: "missing Notion-Version" });
    if (url.pathname === "/v1/users/me") return json(res, 200, { object: "user", name: "Fixture Bot", bot: { workspace_name: LIVE_FIXTURE.notion.workspace } });
    if (url.pathname === "/v1/search" && req.method === "POST") return json(res, 200, { results: state.notionPages });
    if (url.pathname === "/v1/users") return json(res, 200, { results: [{ id: "u1", name: "Alice" }] });
    return json(res, 404, { message: "unknown fixture path" });
  }

  function confluence(req, res, url) {
    if (req.headers.authorization !== basic(LIVE_FIXTURE.confluence.email, LIVE_FIXTURE.confluence.token)) return unauthorized(res);
    if (url.pathname === "/wiki/rest/api/user/current") return json(res, 200, { accountId: LIVE_FIXTURE.confluence.accountId, displayName: "Alice Fixture" });
    if (url.pathname === "/wiki/rest/api/content/search" && url.searchParams.get("cql")?.includes("currentUser()")) {
      return json(res, 200, { results: state.confluencePages, _links: { base: `${LIVE_FIXTURE.confluence.site}/wiki` } });
    }
    return json(res, 404, { message: "unknown fixture path" });
  }

  async function google(req, res, url, body) {
    if (req.headers.host === "accounts.google.com") {
      const redirect = url.searchParams.get("redirect_uri");
      const stateParam = url.searchParams.get("state");
      if (url.pathname !== "/o/oauth2/v2/auth" || !redirect) return json(res, 404, {});
      res.writeHead(302, { location: `${redirect}?state=${encodeURIComponent(stateParam ?? "")}&code=${encodeURIComponent(LIVE_FIXTURE.gdrive.code)}`, "content-length": 0 });
      return res.end();
    }
    if (req.headers.host === "oauth2.googleapis.com") {
      const form = new URLSearchParams(body);
      if (form.get("client_id") !== LIVE_FIXTURE.gdrive.clientId || form.get("client_secret") !== LIVE_FIXTURE.gdrive.clientSecret) return json(res, 401, { error: "invalid_client" });
      if (form.get("grant_type") === "authorization_code") {
        if (!state.googleCodes.has(form.get("code")) || form.get("redirect_uri") !== "http://127.0.0.1:53682/ardia-oauth" || !form.get("code_verifier")) return json(res, 400, { error: "invalid_grant" });
        state.googleRefreshValid = true;
        return json(res, 200, { access_token: issueGoogle("authorization_code"), refresh_token: LIVE_FIXTURE.gdrive.refreshToken, expires_in: 3600, token_type: "Bearer" });
      }
      if (form.get("grant_type") === "refresh_token") {
        state.googleRenewals++;
        if (state.googleRenewDelayMs) await new Promise((resolve) => setTimeout(resolve, state.googleRenewDelayMs));
        if (res.destroyed) return true;
        if (!state.googleRefreshValid || form.get("refresh_token") !== LIVE_FIXTURE.gdrive.refreshToken) return json(res, 400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
        return json(res, 200, { access_token: issueGoogle("refresh_token"), expires_in: 3600, token_type: "Bearer" });
      }
      return json(res, 400, { error: "unsupported_grant_type" });
    }
    const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
    if (!state.googleAccess.has(token)) return unauthorized(res);
    if (url.pathname === "/drive/v3/about" && url.searchParams.get("fields") === "user") return json(res, 200, { user: { displayName: "Alice Fixture", emailAddress: LIVE_FIXTURE.gdrive.email } });
    if (url.pathname === "/drive/v3/files" && url.searchParams.get("pageSize") === "30") return json(res, 200, { files: state.driveFiles });
    return json(res, 404, { error: { message: "unknown fixture path" } });
  }

  async function handle(req, res, body) {
    const host = String(req.headers.host ?? "").split(":")[0];
    if (!LIVE_HOSTS.includes(host)) return false;
    if (state.offline) {
      req.socket.destroy();
      return true;
    }
    const url = new URL(req.url, `https://${host}`);
    state.requests.push({ host, method: req.method, path: url.pathname, search: url.search, headers: { ...req.headers }, body });
    const active = (state.active.get(host) ?? 0) + 1;
    state.active.set(host, active);
    state.maxActive.set(host, Math.max(state.maxActive.get(host) ?? 0, active));
    try {
      const delay = state.delayMs.get(host) ?? 0;
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (res.destroyed) return true;
      const route = host === "api.github.com" || host === "github.com" ? github : host === "api.bitbucket.org" ? bitbucket : host === "api.notion.com" ? notion : host === "acme.atlassian.net" ? confluence : google;
      const handled = await route(req, res, url, body);
      if (handled === false) json(res, 404, { message: "unknown fixture route" });
      return true;
    } finally {
      state.active.set(host, state.active.get(host) - 1);
    }
  }

  return {
    state,
    handle,
    requests: (host) => state.requests.filter((r) => !host || r.host === host),
    revokeGithub: () => state.githubTokens.clear(),
    revokeGoogleRefresh: () => (state.googleRefreshValid = false),
    expireGoogleAccess: () => state.googleAccess.clear(),
  };
}
