import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { frameOrigin, frameRates, pdfDocument, pdfFrameTargets, pdfRates, servePdf } from "./scroll-frames-pdf.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const bench = join(here, "scroll-frames.mjs");
const EXTENSION = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html?https://127.0.0.1:9571/pdf";

const burst = (pid, name, from, count, everyUs, ph = "X") => Array.from({ length: count }, (_, i) => ({ pid, tid: 1, ph, name, ts: from + i * everyUs, dur: 100 }));
const mark = (pid, name, ts) => ({ pid, tid: 1, ph: "R", name, ts });
const frameBurst = (pid, from, count, everyUs, activate = true) => [
  ...burst(pid, "ProxyMain::BeginMainFrame", from, count, everyUs),
  ...burst(pid, "ProxyImpl::ScheduledActionDraw", from + 500, count, everyUs),
  ...(activate ? burst(pid, "ProxyImpl::DidActivateSyncTreeOnImplThread", from + 300, count, everyUs, "I") : []),
];

test("the generated PDF is a valid multi-page document with a correct cross-reference table", () => {
  const bytes = pdfDocument(40);
  const text = bytes.toString("latin1");
  assert.equal(text.slice(0, 8), "%PDF-1.4");
  assert.ok(text.endsWith("%%EOF\n"));
  assert.match(text, /\/Count 40 /);
  assert.equal((text.match(/\/Type \/Page /g) ?? []).length, 40);
  const xref = Number(/startxref\n(\d+)\n/.exec(text)[1]);
  assert.equal(text.slice(xref, xref + 4), "xref");
  const entries = text.slice(xref).split("\n").filter((l) => /^\d{10} 00000 n $/.test(l));
  assert.equal(entries.length, 3 + 2 * 40);
  entries.forEach((entry, i) => {
    const at = Number(entry.slice(0, 10));
    assert.equal(text.slice(at, at + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`);
  });
  for (const [, length, body] of text.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) assert.equal(body.length, Number(length));
});

test("the default PDF is long enough to scroll for a whole gesture", () => {
  assert.ok(Number(/\/Count (\d+) /.exec(pdfDocument().toString("latin1"))[1]) >= 200);
});

test("the local server answers the PDF with the application/pdf content type", async () => {
  const server = createServer((req, res) => servePdf(res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/pdf`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = Buffer.from(await res.arrayBuffer());
    assert.equal(body.subarray(0, 5).toString(), "%PDF-");
    assert.equal(body.length, Number(res.headers.get("content-length")));
  } finally {
    server.close();
  }
});

test("pdf/trackpad is a case, and the bench's --list and --help name it", () => {
  const list = spawnSync(process.execPath, [bench, "--list"], { encoding: "utf8" });
  assert.equal(list.status, 0, list.stderr);
  assert.ok(list.stdout.split("\n").includes("pdf/trackpad"));
  assert.ok(list.stdout.split("\n").includes("article/trackpad"));
  const help = spawnSync(process.execPath, [bench, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /pdf\/trackpad scrolls a generated multi-page PDF/);
});

test("the bench serves the PDF from its server and reads the frames of the PDF's own processes", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(bench, "utf8");
  assert.match(source, /if \(name === "pdf"\) return servePdf\(res\)/);
  assert.match(source, /\{ id: "pdf\/trackpad", page: "pdf", src: "trackpad", pdf: true \}/);
  assert.match(source, /c\.pdf \? pdfRates\(events, rep, refreshMs\) : \[analyse\(events, rep, refreshMs\)\]/);
});

test("the viewer and the content frame are told apart by their targets", () => {
  const list = [
    { id: "page", type: "page", url: "http://127.0.0.1:9571/pdf" },
    { id: "viewer", type: "iframe", parentId: "page", url: EXTENSION },
    { id: "content", type: "iframe", parentId: "viewer", url: "chrome-untrusted://pdf-content/doc" },
    { id: "ad", type: "iframe", parentId: "page", url: "https://ads.example/frame" },
  ];
  const found = pdfFrameTargets(list);
  assert.equal(found.viewer.id, "viewer");
  assert.equal(found.content.id, "content");
  assert.deepEqual(found.seen.map((t) => t.type), ["page", "iframe", "iframe", "iframe"]);
  assert.ok(found.seen.every((t) => !JSON.stringify(t).includes("?")));
});

test("a PDF page with no viewer frame has no viewer and no content frame", () => {
  const found = pdfFrameTargets([{ id: "page", type: "page", url: "http://127.0.0.1:9571/pdf" }]);
  assert.equal(found.viewer, undefined);
  assert.equal(found.content, undefined);
});

test("a viewer with no frame of its own below it has no content frame", () => {
  const found = pdfFrameTargets([{ id: "page", type: "page", url: "http://x/" }, { id: "viewer", type: "iframe", url: EXTENSION }]);
  assert.equal(found.viewer.id, "viewer");
  assert.equal(found.content, undefined);
});

test("only the origin of a frame is recorded", () => {
  assert.equal(frameOrigin(EXTENSION), "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai");
  assert.equal(frameOrigin("https://example.com/a/b?token=1#x"), "https://example.com");
  assert.equal(frameOrigin(""), "unparsable");
});

test("frameRates counts draws, main frames, late draws and stale draws inside the window", () => {
  const events = [
    ...burst(7, "ProxyImpl::ScheduledActionDraw", 1_000_000, 11, 8333),
    ...burst(7, "ProxyMain::BeginMainFrame", 1_000_000, 6, 16667),
    ...burst(7, "ProxyImpl::DidActivateSyncTreeOnImplThread", 1_000_100, 6, 16667, "I"),
    ...burst(7, "ProxyImpl::ScheduledActionDraw", 5_000_000, 5, 8333),
    ...burst(8, "ProxyImpl::ScheduledActionDraw", 1_000_000, 11, 8333),
  ];
  const rates = frameRates(events, 7, 1_000_000, 1_200_000, 8.33);
  assert.equal(rates.draws, 11);
  assert.equal(rates.mains, 6);
  assert.equal(rates.drawHz, 120);
  assert.equal(rates.mainHz, 60);
  assert.equal(rates.drawsLate, 0);
  assert.equal(rates.stalePct, 50);
});

test("a draw gap over one and a half refresh intervals counts as late", () => {
  const events = [...burst(7, "ProxyImpl::ScheduledActionDraw", 0, 4, 8333), ...burst(7, "ProxyImpl::ScheduledActionDraw", 60_000, 4, 8333)];
  assert.equal(frameRates(events, 7, 0, 200_000, 8.33).drawsLate, 1);
});

const rep = (frames) => ({ start: "pdf-start", end: "pdf-end", frames });
const viewer = { role: "viewer", mark: "pdf-start", origin: "chrome-extension://abc" };
const content = { role: "content", mark: "pdf-content", origin: "chrome-untrusted://pdf" };

test("pdfRates writes one row for the viewer's process and one for the content frame's process", () => {
  const events = [
    mark(21, "pdf-content", 999_000),
    mark(11, "pdf-start", 1_000_000),
    ...frameBurst(11, 1_000_000, 60, 8333),
    ...frameBurst(21, 1_000_000, 30, 16667),
    mark(11, "pdf-end", 1_500_000),
  ];
  const rows = pdfRates(events, rep([viewer, content]), 8.33);
  assert.deepEqual(rows.map((r) => [r.role, r.pid]), [["viewer", 11], ["content", 21]]);
  assert.equal(rows[0].origin, "chrome-extension://abc");
  assert.equal(rows[0].ms, 500);
  assert.equal(rows[0].mainHz, 120);
  assert.equal(rows[0].drawHz, 120);
  assert.equal(rows[0].stalePct, 0);
  assert.equal(rows[1].mainHz, 60);
  assert.equal(rows[1].drawHz, 60);
  assert.equal(rows[1].drawsLate, 29);
  assert.equal(rows[1].mains, 30);
  assert.equal(rows[1].draws, 30);
});

test("pdfRates reads each process only inside the gesture", () => {
  const events = [
    mark(21, "pdf-content", 1),
    mark(11, "pdf-start", 1_000_000),
    ...frameBurst(21, 100, 20, 8333),
    ...frameBurst(21, 1_000_000, 20, 8333),
    ...frameBurst(21, 9_000_000, 20, 8333),
    mark(11, "pdf-end", 1_200_000),
  ];
  const content21 = pdfRates(events, rep([viewer, content]), 8.33)[1];
  assert.equal(content21.mains, 20);
  assert.equal(content21.draws, 20);
});

test("pdfRates lists any other renderer that drew during the gesture", () => {
  const events = [
    mark(21, "pdf-content", 1),
    mark(11, "pdf-start", 1_000_000),
    ...frameBurst(11, 1_000_000, 10, 8333),
    ...frameBurst(21, 1_000_000, 10, 16667),
    ...frameBurst(33, 1_000_000, 10, 16667),
    ...frameBurst(44, 9_000_000, 10, 16667),
    mark(11, "pdf-end", 1_300_000),
  ];
  const rows = pdfRates(events, rep([viewer, content]), 8.33);
  assert.deepEqual(rows.map((r) => [r.role, r.pid]), [["viewer", 11], ["content", 21], ["other", 33]]);
});

test("pdfRates reports a missing frame mark as that frame's error and keeps the other row", () => {
  const events = [mark(11, "pdf-start", 1_000_000), ...frameBurst(11, 1_000_000, 10, 8333), mark(11, "pdf-end", 1_200_000)];
  const rows = pdfRates(events, rep([viewer, content]), 8.33);
  assert.equal(rows[0].pid, 11);
  assert.deepEqual([rows[1].role, rows[1].error], ["content", "the content mark is missing from the trace"]);
});

test("pdfRates passes a frame that was never found on as an error row", () => {
  const events = [mark(11, "pdf-start", 1_000_000), ...frameBurst(11, 1_000_000, 10, 8333), mark(11, "pdf-end", 1_200_000)];
  const rows = pdfRates(events, rep([viewer, { role: "content", error: "no content frame" }]), 8.33);
  assert.deepEqual([rows[1].role, rows[1].error], ["content", "no content frame"]);
});

test("pdfRates reports a missing start or end mark, and an error from the frame search, without rows of rates", () => {
  assert.deepEqual(pdfRates([], rep([viewer]), 8.33), [{ role: "viewer", error: "the start mark is missing from the trace" }]);
  assert.deepEqual(pdfRates([mark(11, "pdf-start", 1)], rep([viewer]), 8.33), [{ role: "viewer", error: "the end mark is missing from the trace" }]);
  assert.deepEqual(pdfRates([], { error: "no PDF viewer frame" }, 8.33), [{ error: "no PDF viewer frame" }]);
});
