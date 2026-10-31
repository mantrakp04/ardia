import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import https from "node:https";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";
import { startFixtures, SUGGEST_HOST, suggestionsFor } from "../lib/fixtures.mjs";
import { generateTls } from "../lib/tls.mjs";
import { LIVE_HOSTS } from "../lib/liveServices.mjs";

const run = promisify(execFile);

function get(url, { servername, ca, host } = {}) {
  const target = new URL(url);
  const client = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request({ host: "127.0.0.1", port: target.port, path: `${target.pathname}${target.search}`, headers: { host: host ?? target.host }, servername: servername ?? target.hostname, ca, rejectUnauthorized: !!ca, timeout: 5000 }, (response) => {
      const chunks = [];
      const certificate = response.socket?.getPeerCertificate?.() ?? null;
      response.on("data", (c) => chunks.push(c));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks), certificate }));
    });
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.end();
  });
}

describe("fixture servers and certificates", () => {
  let root;
  let tls;
  let fixtures;
  before(async () => {
    root = await mkdtemp(join(tmpdir(), "ardia-acceptance-fixtures-"));
    tls = await generateTls(join(root, "tls"));
    fixtures = await startFixtures({ tls, slowInterval: 10 });
  });
  after(async () => {
    await fixtures.close();
    await rm(root, { recursive: true, force: true });
  });

  it("hashes the trusted key the way Chromium's SPKI list expects", async () => {
    const { stdout } = await run("sh", ["-c", `openssl x509 -in "${join(tls.dir, "leaf.pem")}" -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl base64`]);
    assert.equal(stdout.trim(), tls.trustedSpki);
    assert.notEqual(tls.trustedSpki, tls.untrustedSpki);
    assert.deepEqual(tls.chromiumArgs, [`--ignore-certificate-errors-spki-list=${tls.trustedSpki}`]);
  });

  it("serves trusted hosts from the CA-signed certificate and the bad host from a self-signed one", async () => {
    const secure = await get(fixtures.url.secure(), { ca: tls.ca });
    assert.equal(secure.status, 200);
    assert.match(secure.body.toString(), /Secure fixture/);
    await assert.rejects(get(fixtures.url.badcert(), { ca: tls.ca }), /self-signed|self signed/);
    const bad = await get(fixtures.url.badcert());
    assert.equal(bad.certificate.subject.CN, "badcert.ardia.test");
  });

  it("answers suggestions in the Firefox JSON shape and logs headers", async () => {
    const reply = await get(`https://${SUGGEST_HOST}:${fixtures.ports.https}/complete/search?client=firefox&q=abc`, { ca: tls.ca, host: SUGGEST_HOST });
    assert.deepEqual(JSON.parse(reply.body.toString()), ["abc", suggestionsFor("abc")]);
    assert.equal(fixtures.suggestRequests().at(-1).query.q, "abc");
  });

  it("serves pages, find counts, mixed content and attachments", async () => {
    assert.match((await get(fixtures.url.page(3, "r"))).body.toString(), /<title>Acceptance page 3<\/title>/);
    assert.equal((await get(fixtures.url.find(4, "x"))).body.toString().match(/needle/g).length, 4);
    const mixed = (await get(fixtures.url.mixed())).body.toString();
    assert.match(mixed, /src="http:\/\/insecure-image\.ardia\.test:\d+\/pixel\.png/);
    assert.match(mixed, /action="http:\/\/insecure-form\.ardia\.test:\d+\/submit"/);
    assert.equal((await get(fixtures.url.http("insecure-image.ardia.test", "/pixel.png"))).headers["content-type"], "image/png");
    const file = await get(fixtures.url.download("a.bin", 100));
    assert.equal(file.headers["content-disposition"], 'attachment; filename="a.bin"');
    assert.equal(file.body.length, 100);
  });

  it("holds a slow download until it is released", async () => {
    const name = `held-${Date.now()}.bin`;
    let done = false;
    const pending = get(fixtures.url.slow(name, 65536)).then((r) => { done = true; return r; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(done, false);
    fixtures.release(name);
    const reply = await pending;
    assert.equal(reply.body.length, 65536);
  });

  it("serves the Live provider hosts over the trusted certificate and can go offline", async () => {
    const rules = fixtures.chromiumArgs.find((arg) => arg.startsWith("--host-resolver-rules="));
    for (const host of LIVE_HOSTS) assert.ok(rules.includes(`MAP ${host} 127.0.0.1:${fixtures.ports.https},`), host);
    assert.ok(rules.indexOf("MAP api.github.com") < rules.indexOf("MAP * ~NOTFOUND"));
    const url = `https://api.notion.com:${fixtures.ports.https}/v1/users/me`;
    const denied = await get(url, { ca: tls.ca, host: "api.notion.com" });
    assert.equal(denied.status, 401);
    assert.equal(fixtures.live.requests("api.notion.com").length, 1);
    fixtures.live.state.offline = true;
    await assert.rejects(get(url, { ca: tls.ca, host: "api.notion.com" }));
    fixtures.live.state.offline = false;
  });

  it("maps the test hosts and the suggestion host and blocks everything else", () => {
    const rules = fixtures.chromiumArgs.find((a) => a.startsWith("--host-resolver-rules="));
    assert.match(rules, /MAP \*\.ardia\.test 127\.0\.0\.1/);
    assert.match(rules, new RegExp(`MAP ${SUGGEST_HOST.replace(/\./g, "\\.")} 127\\.0\\.0\\.1:${fixtures.ports.https}`));
    assert.match(rules, /MAP \* ~NOTFOUND/);
  });
});
