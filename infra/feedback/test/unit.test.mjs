import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { APP_INGEST_KEY, CLI_INGEST_KEY, SITE_INGEST_KEY } from "../lib/core.mjs";
import { rateLimiter } from "../lib/http.mjs";
import { ID_ALPHABET, ID_PATTERN, newId, normalizeId, randomId } from "../lib/ids.mjs";
import { quietMentions, scrubForIssue, scrubText } from "../lib/scrub.mjs";
import { feedbackEvent, issueFor } from "../lib/service.mjs";
import { bearerToken, issueUploadToken, uploadTokenProblem } from "../lib/tokens.mjs";
import { MIB, attachmentRule, validateReport } from "../lib/validate.mjs";

const INSTALL = "3f1c2a9e-8b7d-4c6e-9f0a-1b2c3d4e5f60";
const valid = (over = {}) => ({
  kind: "bug",
  title: "Sidebar flickers",
  description: "It flickers when I switch spaces.",
  source: "app",
  install_id: INSTALL,
  app_version: "0.2.45",
  ...over,
});
const problem = (body) => validateReport(body).error?.field;

test("validateReport accepts a full report and normalizes it", () => {
  const { report, error } = validateReport(valid({
    title: "  Sidebar flickers  ",
    description: "line one\r\nline two\tend",
    session_id: "0192F3A4-5B6C-7D8E-9FA0-B1C2D3E4F506",
    app_build: "4512",
    channel: "nightly",
    os_version: "26.1",
    arch: "arm64",
    contact: "",
    page_address: "https://example.com/a?b=c",
    watch_days: 14,
    diagnostics: { tabs: 3 },
    attachments: [{ name: "recording.mp4", bytes: 5 * MIB, type: "Video/MP4" }, { name: "crash-1.ips", bytes: 10, type: "text/plain" }],
  }));
  assert.equal(error, undefined);
  assert.equal(report.title, "Sidebar flickers");
  assert.equal(report.description, "line one\nline two\tend");
  assert.equal(report.session_id, "0192f3a4-5b6c-7d8e-9fa0-b1c2d3e4f506");
  assert.equal(report.contact, null);
  assert.equal(report.watch_days, 14);
  assert.deepEqual(report.attachments[0], { name: "recording.mp4", bytes: 5 * MIB, type: "video/mp4" });
  assert.equal(validateReport(valid()).report.watch_days, 0);
});

test("validateReport counts code points, not UTF-16 units", () => {
  assert.equal(problem(valid({ title: "🐛".repeat(67) })), undefined);
  assert.equal(problem(valid({ title: "🐛".repeat(68) })), "title");
  assert.equal(problem(valid({ description: "é".repeat(4000) })), undefined);
  assert.equal(problem(valid({ description: "é".repeat(4001) })), "description");
  assert.equal(problem(valid({ contact: "a".repeat(201) })), "contact");
  assert.equal(problem(valid({ page_address: "a".repeat(2049) })), "page_address");
});

test("validateReport rejects bad kinds, sources, ids and unknown fields", () => {
  assert.equal(problem(valid({ kind: "rant" })), "kind");
  assert.equal(problem(valid({ source: "site" })), "source");
  assert.equal(problem(valid({ title: "   " })), "title");
  assert.equal(problem(valid({ title: "two\nlines" })), "title");
  assert.equal(problem(valid({ description: "bell\u0007" })), "description");
  assert.equal(problem(valid({ install_id: "not-a-uuid" })), "install_id");
  assert.equal(problem(valid({ install_id: undefined })), "install_id");
  assert.equal(problem(valid({ session_id: 7 })), "session_id");
  assert.equal(problem(valid({ app_version: undefined })), "app_version");
  assert.equal(problem(valid({ source: "cli" })), "cli_version");
  assert.equal(problem(valid({ source: "cli", cli_version: "0.4.0", app_version: undefined })), undefined);
  assert.equal(problem(valid({ channel: "x".repeat(65) })), "channel");
  assert.equal(problem(valid({ watch_days: 7 })), "watch_days");
  assert.equal(problem(valid({ $session_id: "x" })), "$session_id");
  assert.equal(problem([]), "body");
  assert.equal(problem(valid({ diagnostics: [1] })), "diagnostics");
  assert.equal(problem(valid({ diagnostics: { blob: "x".repeat(64 * 1024) } })), "diagnostics");
});

test("validateReport checks attachment names, caps, types and duplicates", () => {
  const one = (a) => problem(valid({ attachments: [a] }));
  assert.equal(one({ name: "recording.mp4", bytes: 100 * MIB, type: "video/mp4" }), undefined);
  assert.equal(one({ name: "recording.mp4", bytes: 100 * MIB + 1, type: "video/mp4" }), "attachments[0].bytes");
  assert.equal(one({ name: "trace.json.gz", bytes: 50 * MIB + 1, type: "application/gzip" }), "attachments[0].bytes");
  assert.equal(one({ name: "attachment-3.png", bytes: 10 * MIB + 1, type: "image/png" }), "attachments[0].bytes");
  assert.equal(one({ name: "../etc/passwd", bytes: 1, type: "text/plain" }), "attachments[0].name");
  assert.equal(one({ name: "crash-0.ips", bytes: 1, type: "text/plain" }), "attachments[0].name");
  assert.equal(one({ name: "attachment-1.PNG", bytes: 1, type: "image/png" }), "attachments[0].name");
  assert.equal(one({ name: "crash-1.ips", bytes: 0, type: "text/plain" }), "attachments[0].bytes");
  assert.equal(one({ name: "crash-1.ips", bytes: 1.5, type: "text/plain" }), "attachments[0].bytes");
  assert.equal(one({ name: "crash-1.ips", bytes: 1, type: "text plain" }), "attachments[0].type");
  assert.equal(one({ name: "crash-1.ips", bytes: 1, type: "text/plain", path: "/x" }), "attachments[0].path");
  const twice = { name: "crash-1.ips", bytes: 1, type: "text/plain" };
  assert.equal(problem(valid({ attachments: [twice, twice] })), "attachments[1].name");
  const many = Array.from({ length: 17 }, (_, i) => ({ name: `attachment-${i + 1}.txt`, bytes: 1, type: "text/plain" }));
  assert.equal(problem(valid({ attachments: many })), "attachments");
  assert.equal(attachmentRule("local-events.jsonl.gz").cap, 10 * MIB);
  assert.equal(attachmentRule("recording.mov"), null);
});

test("upload tokens verify, expire and stay bound to their report", () => {
  const secret = "s".repeat(32);
  const now = Date.parse("2026-11-07T12:00:00Z");
  const token = issueUploadToken(secret, "FB-AB23", now + 60_000);
  assert.equal(uploadTokenProblem(secret, token, "FB-AB23", now), null);
  assert.equal(uploadTokenProblem(secret, token, "FB-AB23", now + 60_000), "expired");
  assert.equal(uploadTokenProblem(secret, token, "FB-ZZ99", now), "other_report");
  assert.equal(uploadTokenProblem("t".repeat(32), token, "FB-AB23", now), "invalid");
  const [id, exp, sig] = token.split(".");
  assert.equal(uploadTokenProblem(secret, `${id}.${Number(exp) + 3600}.${sig}`, "FB-AB23", now), "invalid");
  assert.equal(uploadTokenProblem(secret, `${id}.${exp}`, "FB-AB23", now), "malformed");
  assert.equal(uploadTokenProblem(secret, null, "FB-AB23", now), "missing");
  assert.equal(bearerToken(`Bearer ${token}`), token);
  assert.equal(bearerToken(`Basic ${token}`), null);
  assert.equal(bearerToken(undefined), null);
});

test("reference ids use the unambiguous alphabet and skip taken ones", async () => {
  assert.equal(ID_ALPHABET.length, 32);
  assert.equal(new Set(ID_ALPHABET).size, 32);
  for (const c of "01IO") assert.ok(!ID_ALPHABET.includes(c));
  for (let i = 0; i < 2000; i++) assert.match(randomId(4), ID_PATTERN);
  assert.match(randomId(5), ID_PATTERN);
  assert.doesNotMatch("FB-AB0D", ID_PATTERN);
  assert.equal(normalizeId("fb-ab23"), "FB-AB23");
  assert.equal(normalizeId("FB-AB2"), null);
  assert.equal(normalizeId("FB-ABCDEF"), null);
  const seen = [];
  const id = await newId(async (candidate) => {
    seen.push(candidate);
    return seen.length <= 8;
  });
  assert.equal(seen.length, 9);
  assert.equal(id.length, 8);
  await assert.rejects(newId(async () => true), /no free reference id/);
});

test("scrubText removes emails, secrets, URL queries and home paths", () => {
  const ghp = `ghp_${"a1B2".repeat(9)}`;
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
  const cases = [
    ["mail me at jane.doe+ardia@example.co.uk please", "mail me at [email] please"],
    [`token ${ghp} leaked`, "token [secret] leaked"],
    [`github_pat_${"x".repeat(30)}`, "[secret]"],
    ["key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123", "key [secret]"],
    ["AKIAABCDEFGHIJKLMNOP", "[secret]"],
    ["xoxb-123456789012-abcdefghij", "[secret]"],
    [`jwt ${jwt}`, "jwt [secret]"],
    ["Authorization: Bearer abcdefghijklmnop1234", "Authorization: [secret]"],
    ["see https://example.com/path?token=abc&x=1#frag.", "see https://example.com/path."],
    ["(https://user:pw@host.dev/a?b)", "(https://host.dev/a)"],
    ["crash in /Users/jane/Library/Logs and /home/bob/x", "crash in /Users/[user]/Library/Logs and /home/[user]/x"],
    ["file:///Users/jane/a.html?x=1", "file:///Users/[user]/a.html"],
    ["Bearer short", "Bearer short"],
    ["the password field is broken", "the password field is broken"],
    ["password=hunter2 then it failed", "password=[secret]"],
    ["X-Api-Key: short-secret", "X-Api-Key: [secret]"],
    ['Cookie: session="shortsecret"; other=anothersecret', "Cookie: [secret]"],
    ["it sent Bearer abc123 and got 401", "it sent Bearer [secret] and got 401"],
    ["OPENAI_API_KEY=abc123 python x.py", "OPENAI_API_KEY=[secret]"],
    ["my sid=abc; done", "my sid=[secret]; done"],
    ["curl -u me:pass https://x.com/a", "curl -u [secret]"],
    ["the session expired after auth, token refresh broke", "the session expired after auth, token refresh broke"],
    ['password="part1\\"part2" then', "password=[secret]"],
    ["curl --password hunter2 https://x.dev", "curl --password [secret]"],
    ['Authorization: Digest username="bob",\n  response="secretresponse",\n\topaque="tab"\nAccept: text/html', "Authorization: [secret]\nAccept: text/html"],
    ["curl -H 'Authorization: Bearer abc' --header \"X-Api-Key: k123\" -H 'Cookie: a=b; c=d' -H 'Accept: text/html' https://e.com/api?q=1", "curl -H 'Authorization: [secret]"],
    [`curl --password "part1"'part2' x`, "curl --password [secret]"],
    ["curl --password part1\\ part2", "curl --password [secret]"],
    ['PASSWORD="part1\npart2"\nNEXT=ok', "PASSWORD=[secret]\nNEXT=ok"],
    ["Authorization: Digest realm=\"api\",\n  username*=UTF-8''bob,\n  response=\"part1\",\n  opaque=\"part2\"\nAccept: text/html", "Authorization: [secret]\nAccept: text/html"],
    ["Typing lags in the password field on github.com", "Typing lags in the password field on github.com"],
    ["digest of the week", "digest of the week"],
    ["private_key: -----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIKEYBODY91\n-----END PRIVATE KEY-----\nnext ok", "private_key: [secret]\nnext ok"],
    ["curl --password \\\nforgedPass91 https://example.com\nthen it crashed", "curl --password [secret]\nthen it crashed"],
    ["access_tokens:\n- forgedToken91\n- forgedToken92\nother: fine", "access_tokens:[secret]\nother: fine"],
    ["curl -udemo:forgedPass91 https://example.com", "curl -u[secret]"],
    ['const body = "{\\"password\\":\\"forgedPass91\\"}";', 'const body = "{\\"password\\":[secret]'],
    ["DATABASE_URL=postgresql://demo:forgedPass91@localhost:5432/app", "DATABASE_URL=postgresql://localhost:5432/app"],
    ['PASSWORD="""\nfirstSegment91"\nsecondSegment92\n"""\nafter ok', "PASSWORD=[secret]\nafter ok"],
    ["curl -H 'Authorization: Bearer forgedToken91' https://example.com\n1. open a tab\n2. it crashes", "curl -H 'Authorization: [secret]\n1. open a tab\n2. it crashes"],
    ["-update the sidebar", "-update the sidebar"],
    ["access_tokens: # test API\n- demoSecret91\nnext: ok", "access_tokens: [secret]\nnext: ok"],
    ["access_tokens:\n\n- demoSecret92\nnext: ok", "access_tokens:[secret]\n\nnext: ok"],
    ['curl --password \\\n"demoPart91\ndemoPart92"\nafter ok', "curl --password [secret]\nafter ok"],
    ["Here's my config: PASSWORD='demoPart93\ndemoPart94'\nafter ok", "Here's my config: PASSWORD=[secret]\nafter ok"],
    ["Here's the request: curl --password demoSecret95 https://example.com\n1. Open a tab\nActual: blank tab", "Here's the request: curl --password [secret]\n1. Open a tab\nActual: blank tab"],
    ["It doesn't work when I'm signed in", "It doesn't work when I'm signed in"],
  ];
  for (const [input, expected] of cases) assert.equal(scrubText(input), expected, input);
  const key = "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\ndef\n-----END OPENSSH PRIVATE KEY-----";
  assert.equal(scrubText(`k: ${key} end`), "k: [secret] end");
});

test("quietMentions keeps GitHub from pinging anyone", () => {
  assert.equal(quietMentions("ping @mantrakp04 and @org/team"), "ping @\u200bmantrakp04 and @\u200borg/team");
  assert.equal(quietMentions("`@types/node`"), "`@types/node`");
  assert.equal(scrubForIssue("me@example.com @bob"), "[email] @\u200bbob");
});

test("issueFor puts only public-safe fields in the issue", () => {
  const report = {
    id: "FB-AB23", kind: "slow", source: "app", title: "Slow @bob", description: "Typing lags at /Users/jane/x, mail jane@x.io",
    app_version: "0.2.45", app_build: "45|12", channel: "nightly", os_version: "26.1", arch: "arm64",
    contact: "jane@x.io", page_address: "https://secret.example/a", diagnostics: { tabs: 400 },
    attachments: [{ name: "recording.mp4", bytes: 1, type: "video/mp4" }], install_id: INSTALL,
  };
  const issue = issueFor(report, "https://dash.ardia.dev");
  assert.deepEqual(issue.labels, ["feedback", "bug"]);
  assert.deepEqual(issueFor({ ...report, kind: "bug" }, "https://d").labels, ["feedback", "bug"]);
  assert.deepEqual(issueFor({ ...report, kind: "idea" }, "https://d").labels, ["feedback", "enhancement"]);
  assert.deepEqual(issueFor({ ...report, kind: "other" }, "https://d").labels, ["feedback"]);
  assert.equal(issue.title, "Slow @\u200bbob");
  assert.match(issue.body, /Typing lags at \/Users\/\[user\]\/x, mail \[email\]/);
  assert.match(issue.body, /\| Version \| Ardia 0\.2\.45 \(45\\\|12\) nightly \|/);
  assert.match(issue.body, /\| macOS \| 26\.1 \|/);
  assert.match(issue.body, /https:\/\/dash\.ardia\.dev\/feedback\/FB-AB23/);
  for (const secret of ["jane@x.io", "secret.example", "recording.mp4", "400", INSTALL, "arm64"]) assert.ok(!issue.body.includes(secret), secret);
  const leaky = issueFor({ ...report, title: "password=hunter2", description: 'password="part1\\"part2"\nAuthorization: Digest username="bob",\n  response="secretresponse"\ncurl --password hunter3 -H "X-Api-Key: short-secret"\nCookie: session="shortsecret"; other=anothersecret\ncurl --password "part3"\'part4\' x\ncurl --password part5\\ part6\nPASSWORD="part7\npart8"\nAuthorization: Digest realm="api",\n  username*=UTF-8\'\'bob,\n  response="part9",\n  opaque="part10"' }, "https://d");
  const leaky2 = issueFor({ ...report, title: "t", description: ["private_key: -----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIKEYBODY91\n-----END PRIVATE KEY-----", "curl --password \\\nforgedPass91 https://example.com", "access_tokens:\n- forgedToken93", "curl -udemo:forgedPass94 https://example.com", 'const body = "{\\"password\\":\\"forgedPass95\\"}";', "DATABASE_URL=postgresql://demo:forgedPass96@localhost:5432/app", 'PASSWORD="""\nfirstSegment97"\nsecondSegment98\n"""', "curl -H 'Authorization: Bearer forgedToken99' https://example.com", "1. open a tab"].join("\n") }, "https://d");
  for (const secret of ["KEYBODY91", "forgedPass91", "forgedToken93", "forgedPass94", "forgedPass95", "forgedPass96", "firstSegment97", "secondSegment98", "forgedToken99"]) assert.ok(!leaky2.body.includes(secret), secret);
  assert.ok(leaky2.body.includes("1. open a tab"));
  const leaky3 = issueFor({ ...report, title: "t", description: "access_tokens: # test API\n- demoSecret81\n\ncurl --password \\\n\"demoPart82\ndemoPart83\"\nHere's my config: PASSWORD='demoPart84\ndemoPart85'\nHere's the request: curl --password demoSecret86 https://example.com\n1. Open a tab" }, "https://d");
  for (const secret of ["demoSecret81", "demoPart82", "demoPart83", "demoPart84", "demoPart85", "demoSecret86"]) assert.ok(!leaky3.body.includes(secret), secret);
  assert.ok(leaky3.body.includes("1. Open a tab"));
  for (const secret of ["hunter2", "hunter3", "part1", "part2", "part3", "part4", "part5", "part6", "part7", "part8", "part9", "part10", "secretresponse", "short-secret", "shortsecret", "anothersecret"]) {
    assert.ok(!leaky.title.includes(secret) && !leaky.body.includes(secret), secret);
  }
  const cli = issueFor({ ...report, source: "cli", cli_version: "0.4.0", app_version: null }, "https://d");
  assert.match(cli.body, /\| Version \| CLI 0\.4\.0 \|/);
});

test("feedbackEvent has the shape of other events", () => {
  const report = {
    id: "FB-AB23", uuid: "9a3b1c2d-0000-4000-8000-000000000001", install_id: INSTALL, session_id: null, kind: "bug", source: "cli",
    title: "t", description: "d", cli_version: "0.4.0", app_version: null, watch_days: 14, watch_until: "2026-11-21T12:00:00.000Z",
    diagnostics: { a: 1 }, attachments: [], created_at: "2026-11-07T12:00:00.000Z",
  };
  const attachments = [{ name: "recording.mp4", bytes: 9, type: "video/mp4", received: true }];
  const body = feedbackEvent(report, { attachments, issue: { number: 12, url: "https://github.com/x/y/issues/12" }, completedAtMs: 1762516800000 });
  const [resource] = body.resourceLogs;
  assert.deepEqual(resource.resource.attributes[0], { key: "service.name", value: { stringValue: "ardia-feedback" } });
  const record = resource.scopeLogs[0].logRecords[0];
  assert.equal(resource.scopeLogs[0].scope.name, "ardia.analytics");
  assert.equal(record.body.stringValue, "feedback_submitted");
  assert.equal(record.timeUnixNano, "1762516800000000000");
  const attrs = Object.fromEntries(record.attributes.map((a) => [a.key, a.value]));
  assert.deepEqual(attrs.event, { stringValue: "feedback_submitted" });
  assert.deepEqual(attrs.distinct_id, { stringValue: INSTALL });
  assert.deepEqual(attrs.uuid, { stringValue: report.uuid });
  assert.deepEqual(attrs.issue_number, { intValue: "12" });
  assert.deepEqual(attrs.has_recording, { boolValue: true });
  assert.deepEqual(attrs.watch_days, { intValue: "14" });
  assert.deepEqual(attrs.diagnostics, { stringValue: '{"a":1}' });
  assert.equal(JSON.parse(attrs.attachments.stringValue)[0].received, true);
  assert.equal(attrs.$session_id, undefined);
  assert.equal(attrs.name, undefined);
});

test("rateLimiter allows a burst per key, then refills over the window", () => {
  let now = 0;
  const allow = rateLimiter({ limit: 2, windowMs: 1000, now: () => now });
  assert.equal(allow("a"), true);
  assert.equal(allow("a"), true);
  assert.equal(allow("a"), false);
  assert.equal(allow("b"), true);
  now = 1001;
  assert.equal(allow("a"), true);
});

test("nginx knows every ingest key", () => {
  const nginx = readFileSync(new URL("../../site/nginx.conf", import.meta.url), "utf8");
  for (const key of [APP_INGEST_KEY, CLI_INGEST_KEY, SITE_INGEST_KEY]) assert.ok(nginx.includes(`"${key}"`), key);
});
