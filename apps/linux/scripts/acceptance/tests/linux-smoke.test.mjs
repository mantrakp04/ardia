import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { launchArguments, launchEnvironment } from "../lib/ardia.mjs";
import { ASSERTIONS, USAGE, commandLine, fixturePage, forbiddenSwitches, formatTable, launchRefusal, lddMissing, modeProblems, parseArgs, parseStat, parseStatus, pngInk, processTree, processType, sandboxVerdict, summarize } from "../../../../../scripts/linux/smoke.mjs";

const status = ({ seccomp = 0, nspid = [100] } = {}) => ({ seccomp, seccompFilters: seccomp === 2 ? 1 : 0, nspid, uid: [1000, 1000, 1000, 1000], noNewPrivs: seccomp === 2 ? 1 : 0 });
const proc = (pid, ppid, argv, { seccomp, nspid, user = "user:[1]", pidNs = "pid:[1]", pgrp = 10 } = {}) => ({ pid, ppid, pgrp, argv, status: status({ seccomp, nspid: nspid ?? [pid] }), ns: { user, pid: pidNs } });

function healthyTree() {
  return [
    proc(10, 1, ["/opt/ardia/lib/ardia/chrome", "--user-data-dir=/tmp/p"]),
    proc(11, 10, ["/opt/ardia/lib/ardia/chrome", "--type=zygote", "--no-zygote-sandbox"]),
    proc(12, 10, ["/opt/ardia/lib/ardia/chrome", "--type=zygote"], { nspid: [12, 1], user: "user:[2]", pidNs: "pid:[2]" }),
    proc(13, 12, ["/opt/ardia/lib/ardia/chrome", "--type=zygote"], { nspid: [13, 2], user: "user:[2]", pidNs: "pid:[2]" }),
    proc(14, 13, ["/opt/ardia/lib/ardia/chrome", "--type=renderer"], { seccomp: 2, nspid: [14, 3, 1], user: null, pidNs: null }),
    proc(15, 13, ["/opt/ardia/lib/ardia/chrome", "--type=renderer"], { seccomp: 2, nspid: [15, 4, 1], user: "user:[2]", pidNs: "pid:[3]" }),
    proc(16, 11, ["/opt/ardia/lib/ardia/chrome", "--type=gpu-process"]),
    proc(99, 1, ["/usr/bin/other", "--type=renderer", "--no-sandbox"], { pgrp: 99 }),
  ];
}

function png(width, height, rows, color = 2) {
  const channels = color === 6 ? 4 : 3;
  const chunk = (type, body) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    return Buffer.concat([length, Buffer.from(type, "latin1"), body, Buffer.alloc(4)]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = color;
  const raw = Buffer.concat(rows.map(({ filter, bytes }) => Buffer.from([filter, ...bytes])));
  assert.equal(raw.length, height * (width * channels + 1));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("parseArgs needs a package and results, validates the deadline and rejects unknown flags", () => {
  assert.deepEqual(parseArgs(["--package", "a.tar.xz", "--results", "out"]), { package: "a.tar.xz", results: "out", timeoutMs: 300000, keep: false, help: false });
  assert.equal(parseArgs(["--package", "a", "--results", "b", "--timeout-ms", "9000", "--keep"]).timeoutMs, 9000);
  assert.equal(parseArgs(["--help"]).help, true);
  assert.throws(() => parseArgs(["--package", "a"]), /required/);
  assert.throws(() => parseArgs(["--package", "a", "--results", "b", "--timeout-ms", "0"]), /positive integer/);
  assert.throws(() => parseArgs(["--package", "a", "--results", "b", "--timeout-ms", "1.5"]), /positive integer/);
  assert.throws(() => parseArgs(["--package", "--results", "b"]), /needs a value/);
  assert.throws(() => parseArgs(["--package", "a", "--results", "b", "--no-sandbox"]), /unknown argument/);
  for (const name of ASSERTIONS) assert.ok(USAGE.includes(name), name);
});

test("the shared launch helpers give a headless, background, sandboxed launch the smoke accepts", () => {
  const args = launchArguments({ scratch: "/tmp/p", extensions: true });
  const env = launchEnvironment({ scratch: "/tmp/p", base: { PATH: "/usr/bin", DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-1", ARDIA_SWITCHES: "--no-sandbox" } });
  assert.equal(launchRefusal(args, env), null);
  assert.ok(!args.includes("--disable-extensions"));
  assert.match(launchRefusal([...args, "--no-sandbox"], env), /--no-sandbox/);
  assert.match(launchRefusal([...args, "--disable-seccomp-filter-sandbox"], env), /seccomp/);
  assert.match(launchRefusal([...args, "--ardia-ui-dir=/x"], env), /ardia-ui-dir/);
  assert.match(launchRefusal(launchArguments({ scratch: "/tmp/p", ozone: "wayland" }), env), /headless/);
  assert.match(launchRefusal([...args, "--ozone-platform=x11"], env), /headless/);
  assert.match(launchRefusal(args, { ...env, ARDIA_BACKGROUND: undefined }), /ARDIA_BACKGROUND/);
  assert.match(launchRefusal(args, { ...env, WAYLAND_DISPLAY: "wayland-1" }), /WAYLAND_DISPLAY/);
});

test("forbiddenSwitches matches whole switches and their values only", () => {
  assert.deepEqual(forbiddenSwitches(["--no-sandbox", "--no-sandboxed-thing", "--single-process=1", "--disable-gpu"]), ["--no-sandbox", "--single-process=1"]);
});

test("lddMissing reports every unresolved library", () => {
  const output = "\tlinux-vdso.so.1 (0x00007ffd)\n\tlibnss3.so => not found\n\tlibc.so.6 => /usr/lib/libc.so.6 (0x7f)\n\tlibgtk-3.so.0 => not found\n";
  assert.deepEqual(lddMissing(output), ["libnss3.so => not found", "libgtk-3.so.0 => not found"]);
  assert.deepEqual(lddMissing("\tlibc.so.6 => /usr/lib/libc.so.6 (0x7f)\n"), []);
});

test("parseStat reads ppid and pgrp past a command name with spaces and parentheses", () => {
  assert.deepEqual(parseStat("4242 (Chrome_ (Child) IO) S 4000 4100 4100 0 -1 4194560"), { state: "S", ppid: 4000, pgrp: 4100 });
  assert.equal(parseStat("garbage"), null);
});

test("parseStatus reads seccomp, nested pid namespaces and no_new_privs", () => {
  const text = "Name:\tchrome\nUid:\t1000\t1000\t1000\t1000\nNSpid:\t2006049\t14\t1\nNoNewPrivs:\t1\nSeccomp:\t2\nSeccomp_filters:\t1\n";
  assert.deepEqual(parseStatus(text), { seccomp: 2, seccompFilters: 1, nspid: [2006049, 14, 1], uid: [1000, 1000, 1000, 1000], noNewPrivs: 1 });
  assert.equal(parseStatus("Name:\tx\n").seccomp, null);
});

test("commandLine splits NUL-separated and setproctitle space-joined command lines", () => {
  assert.equal(processType(commandLine("/a/chrome\0--type=renderer\0--lang=en\0")), "renderer");
  assert.equal(processType(commandLine("/a/chrome --type=zygote --no-zygote-sandbox")), "zygote");
  assert.equal(processType(commandLine("/a/chrome\0--user-data-dir=/p\0")), "browser");
});

test("processTree follows children of the browser and its process group, nothing else", () => {
  const tree = processTree([...healthyTree(), proc(20, 1, ["crashpad"], { pgrp: 10 })], 10);
  assert.deepEqual(tree.map((p) => p.pid).sort((a, b) => a - b), [10, 11, 12, 13, 14, 15, 16, 20]);
});

test("sandboxVerdict passes seccomp-filtered renderers in their own namespaces and allows the unsandboxed zygote's switch", () => {
  const verdict = sandboxVerdict(processTree(healthyTree(), 10), 10);
  assert.equal(verdict.ok, true, verdict.problems.join("; "));
  assert.equal(verdict.renderers.length, 2);
  assert.ok(verdict.renderers.every((r) => r.seccomp === 2 && r.nestedPid));
  assert.equal(verdict.renderers[0].otherUserNs, false);
  assert.equal(verdict.renderers[1].otherUserNs, true);
});

test("sandboxVerdict fails a renderer without seccomp, a renderer sharing the browser's namespaces, --no-sandbox anywhere, or no renderer", () => {
  const unfiltered = healthyTree().map((p) => (p.pid === 14 ? { ...p, status: { ...p.status, seccomp: 0 } } : p));
  assert.match(sandboxVerdict(processTree(unfiltered, 10), 10).problems.join(";"), /renderer 14 has Seccomp 0/);
  const shared = healthyTree().map((p) => (p.pid === 15 ? { ...p, status: { ...p.status, nspid: [15] }, ns: { user: "user:[1]", pid: "pid:[1]" } } : p));
  assert.match(sandboxVerdict(processTree(shared, 10), 10).problems.join(";"), /renderer 15 shares the browser's/);
  const unreadable = healthyTree().map((p) => (p.pid === 15 ? { ...p, status: { ...p.status, nspid: [15] }, ns: { user: null, pid: null } } : p));
  assert.equal(sandboxVerdict(processTree(unreadable, 10), 10).ok, false);
  const disabled = healthyTree().map((p) => (p.pid === 16 ? { ...p, argv: [...p.argv, "--no-sandbox"] } : p));
  assert.match(sandboxVerdict(processTree(disabled, 10), 10).problems.join(";"), /pid 16 \(gpu-process\) runs with --no-sandbox/);
  const browserOnly = sandboxVerdict(processTree(healthyTree().filter((p) => p.pid !== 14 && p.pid !== 15), 10), 10);
  assert.match(browserOnly.problems.join(";"), /no renderer/);
  assert.match(sandboxVerdict([], 10).problems.join(";"), /browser process 10 is not in the tree/);
});

test("modeProblems reports missing files, non-files and wrong modes", () => {
  const problems = modeProblems([
    { path: "usr/bin/ardia", expected: 0o755, actual: { mode: 0o100755, isFile: true } },
    { path: "usr/share/applications/ardia.desktop", expected: 0o644, actual: { mode: 0o100664, isFile: true } },
    { path: "usr/lib/ardia/chrome", expected: 0o755, actual: null },
    { path: "usr/lib/ardia/ardia-ui/index.html", expected: 0o644, actual: { mode: 0o40755, isFile: false } },
  ]);
  assert.deepEqual(problems, ["usr/share/applications/ardia.desktop has mode 664, expected 644", "usr/lib/ardia/chrome is missing", "usr/lib/ardia/ardia-ui/index.html is not a regular file"]);
});

test("summarize is ok only when every named assertion ran and passed", () => {
  const all = ASSERTIONS.map((name) => ({ name, ok: true, detail: null, ms: 1 }));
  assert.equal(summarize(all).ok, true);
  assert.deepEqual(summarize(all.slice(1)), { ok: false, missing: [ASSERTIONS[0]] });
  assert.equal(summarize(all.map((a, i) => (i === 3 ? { ...a, ok: false } : a))).ok, false);
  assert.equal(summarize([]).ok, false);
  const table = formatTable([{ name: "ldd", ok: true, ms: 7 }, { name: "sandbox", ok: false, ms: 1200, detail: { error: "renderer 14 has Seccomp 0" } }]);
  assert.match(table, /^pass {2}ldd/m);
  assert.match(table, /^FAIL {2}sandbox .* 1\.2 s {2}renderer 14 has Seccomp 0$/m);
});

test("pngInk decodes filtered RGB and RGBA rows and counts dark pixels", () => {
  const white = [255, 255, 255];
  const rgb = png(3, 3, [
    { filter: 0, bytes: [...white, ...white, ...white] },
    { filter: 1, bytes: [255, 255, 255, 0, 0, 0, 0, 0, 0] },
    { filter: 2, bytes: [0, 0, 0, 0, 0, 0, 0, 0, 0] },
  ]);
  assert.deepEqual(pngInk(rgb), { width: 3, height: 3, ink: 0, ratio: 0 });
  const paeth = png(2, 2, [
    { filter: 0, bytes: [255, 255, 255, 255, 10, 10, 10, 255] },
    { filter: 4, bytes: [0, 0, 0, 0, 0, 0, 0, 0] },
  ], 6);
  assert.equal(pngInk(paeth).ink, 2);
  const average = png(2, 1, [{ filter: 3, bytes: [200, 200, 200, 155, 155, 155] }]);
  assert.equal(pngInk(average).ink, 0);
  const dark = png(2, 1, [{ filter: 3, bytes: [200, 200, 200, 0, 0, 0] }]);
  assert.equal(pngInk(dark).ink, 1);
  assert.throws(() => pngInk(Buffer.from("not a png at all, really not one")), /not a PNG/);
});

test("fixturePage carries the run's token in its title and marker", () => {
  const page = fixturePage("smokeabc");
  assert.match(page, /<title>Ardia smoke smokeabc<\/title>/);
  assert.match(page, /id="smoke-marker"[^>]*>Ardia smoke smokeabc</);
});
