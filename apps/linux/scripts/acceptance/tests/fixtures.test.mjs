import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import https from "node:https";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { after, before, describe, it } from "node:test";
import { MEDIA_TITLE, PIXEL_PNG, startFixtures, SUGGEST_HOST, suggestionsFor, toneWav } from "../lib/fixtures.mjs";
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

  it("serves the site-control pages: storage setters, the permissions page and the blocker page's ad and control images", async () => {
    const setter = await get(fixtures.url.storage("data.ardia.test", "f06data"));
    assert.match(setter.body.toString(), /document\.cookie = "f06data=1; max-age=86400; path=\/"/);
    assert.match(setter.body.toString(), /localStorage\.setItem\("f06data", "1"\)/);
    assert.doesNotMatch((await get(fixtures.url.storage("data.ardia.test", "bad name<"))).body.toString(), /cookie/);
    assert.doesNotMatch((await get(fixtures.url.storage("data.ardia.test"))).body.toString(), /<script>/);
    assert.equal(fixtures.url.permissionsOrigin(), `https://secure.ardia.test:${fixtures.ports.https}`);
    assert.match((await get(fixtures.url.permissions(), { ca: tls.ca })).body.toString(), /Permissions fixture/);
    const page = (await get(fixtures.url.blocker("news.ardia.test", "r1<x"))).body.toString();
    assert.match(page, /<img id="ad" src="\/ads\/banners\/r1x\.png"/);
    assert.match(page, /<img id="control" src="\/pixel\.png\?blocker=r1x"/);
    const ad = await get(`http://news.ardia.test:${fixtures.ports.http}/ads/banners/r1x.png`);
    assert.equal(ad.headers["content-type"], "image/png");
    assert.ok(fixtures.requests.some((r) => r.host === "news.ardia.test" && r.path === "/ads/banners/r1x.png"));
  });

  it("serves the media page with its session script and a playable looping tone", async () => {
    const page = await get(fixtures.url.media("m1"));
    assert.equal(page.status, 200);
    const text = page.body.toString();
    for (const part of ['<audio id="tone" src="/tone.wav" loop>', '<input id="field"', JSON.stringify(MEDIA_TITLE), "setActionHandler", "window.startTone"]) assert.ok(text.includes(part), part);
    const tone = await get(fixtures.url.http("media.ardia.test", "/tone.wav"));
    assert.equal(tone.status, 200);
    assert.equal(tone.headers["content-type"], "audio/wav");
    assert.equal(tone.body.toString("ascii", 0, 4), "RIFF");
    assert.equal(tone.body.toString("ascii", 8, 12), "WAVE");
    assert.equal(tone.body.readUInt32LE(24), 8000);
    assert.equal(tone.body.length, 44 + 8 * 8000 * 2);
    assert.ok(Math.max(...Array.from({ length: 200 }, (_, i) => Math.abs(tone.body.readInt16LE(44 + i * 2)))) > 10000);
    assert.equal(toneWav({ seconds: 0.5, rate: 4000 }).length, 44 + 2000 * 2);
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
    const file = await get(fixtures.url.download("a.bin", 100));
    assert.equal(file.headers["content-disposition"], 'attachment; filename="a.bin"');
    assert.equal(file.body.length, 100);
  });

  it("serves the page-status and favicon fixtures", async () => {
    assert.match((await get(fixtures.url.fullscreen("r"))).body.toString(), /Fullscreen fixture/);
    assert.match((await get(fixtures.url.hover("r"))).body.toString(), /id="link" href="\/page\/5\?hover=r"/);
    const popup = (await get(fixtures.url.popup("a</script>"))).body.toString();
    assert.ok(popup.includes(`window.open(${JSON.stringify(fixtures.url.popupTarget("a</script>"))})`));
    assert.doesNotMatch(popup, /a<\/script>/);
    assert.match((await get(fixtures.url.busy("r"))).body.toString(), /for \(;;\) \{\}/);
    assert.match((await get(fixtures.url.favicon("abc"))).body.toString(), /<link rel="icon" href="\/icon\/abc\.png">/);
    const icon = await get(fixtures.url.icon("abc"));
    assert.equal(icon.headers["content-type"], "image/png");
    assert.deepEqual(icon.body, PIXEL_PNG);
    assert.equal((await get(fixtures.url.icon("bad1"))).body.toString(), "not an image");
  });

  it("serves the page-messaging, selection and tint fixtures", async () => {
    const gestures = (await get(fixtures.url.gestures("r"))).body.toString();
    assert.ok(gestures.includes(`id="link" href="${fixtures.url.page(6, "r")}"`));
    assert.ok(gestures.includes(`<iframe id="frame" src="${fixtures.url.gestureFrame("r")}"`));
    assert.match(gestures, /id="words">Ardia selects quoted words/);
    assert.match(gestures, /<textarea id="field">alpha beta alpha<\/textarea>/);
    assert.match(gestures, /id="tall" style="height:4000px"/);
    const frame = (await get(fixtures.url.gestureFrame("r"))).body.toString();
    assert.ok(frame.includes(`id="link" href="${fixtures.url.page(7, "r")}"`));
    assert.match((await get(fixtures.url.tint("meta"))).body.toString(), /<meta name="theme-color" content="#336699">/);
    assert.match((await get(fixtures.url.tint("header"))).body.toString(), /<header style="position:sticky;top:0;height:120px;background:#aa2244"/);
    assert.match((await get(fixtures.url.tint("background"))).body.toString(), /<body style="background:#22aa66">/);
    const plain = (await get(fixtures.url.tint("plain"))).body.toString();
    assert.doesNotMatch(plain, /theme-color|<header|background:/);
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
