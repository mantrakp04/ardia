import assert from "node:assert/strict";
import { test } from "node:test";
import { launchArguments, launchEnvironment } from "../../apps/linux/scripts/acceptance/lib/ardia.mjs";
import { ASSERTIONS, SCRIPT_NAME, SCRIPT_TITLE_PREFIX, USAGE, USER_SCRIPTS_CAPABILITIES, VERSION_PATTERN, appVersionVerdict, cliControlSupport, cliTarball, formatTable, installerRanAgain, launchRefusal, packageStagedFiles, parseArgs, pipeLaunchArguments, splitPipeMessages, summarize, userScriptSource } from "./smoke.mjs";

test("the package checks are named in the usage and keep the original eight first", () => {
  assert.deepEqual(ASSERTIONS.slice(0, 8), ["ldd", "shell-ui", "bootstrap", "native-tab", "sandbox", "content-blocker", "restart-restore", "staged-install"]);
  for (const name of ["app-version", "cli-install", "cli-control", "cli-scripts"]) {
    assert.ok(ASSERTIONS.includes(name), name);
    assert.ok(USAGE.includes(name), name);
  }
  assert.ok(USAGE.includes("--allow-old-engine"));
});

test("the smoke userscript retitles only the fixture pages and is a userscript the CLI accepts", () => {
  const source = userScriptSource();
  assert.match(source, /^\/\/ ==UserScript==$/m);
  assert.match(source, /^\/\/ ==\/UserScript==$/m);
  assert.ok(source.includes(`// @name        ${SCRIPT_NAME}`));
  assert.match(source, /^\/\/ @match       http:\/\/127\.0\.0\.1\/smoke\/\*$/m);
  assert.ok(source.includes(`document.title = ${JSON.stringify(SCRIPT_TITLE_PREFIX)} + document.title;`));
  assert.deepEqual(USER_SCRIPTS_CAPABILITIES, ["ArdiaUserScripts.watch", "ArdiaUserScripts.read", "ArdiaUserScripts.readStatus", "ArdiaUserScripts.writeStatus"]);
});

test("--allow-old-engine is opt-in and leaves the default options as they were", () => {
  assert.deepEqual(parseArgs(["--package", "a", "--results", "b"]), { package: "a", results: "b", timeoutMs: 300000, keep: false, help: false });
  assert.equal(parseArgs(["--package", "a", "--results", "b", "--allow-old-engine"]).allowOldEngine, true);
});

test("the version pattern is the package contract's", () => {
  for (const good of ["0.2.44", "0.2.44-nightly.3"]) assert.ok(VERSION_PATTERN.test(good), good);
  for (const bad of ["0.2", "0.2.44-nightly", "0.2.44\n", "v0.2.44", "156.0.8078.79"]) assert.ok(!VERSION_PATTERN.test(bad), bad);
  assert.equal(cliTarball("0.2.44"), "ardia-cli-0.2.44-linux-x64.tar.gz");
});

test("staged-install also checks VERSION and the CLI only when the package has them", () => {
  assert.deepEqual(packageStagedFiles(), []);
  assert.deepEqual(packageStagedFiles({ version: "1.2.3" }), [{ path: "usr/lib/ardia/VERSION", mode: 0o644 }]);
  assert.deepEqual(packageStagedFiles({ version: "1.2.3", cli: true }).map((f) => [f.path, f.mode.toString(8)]), [
    ["usr/lib/ardia/VERSION", "644"],
    ["usr/lib/ardia/cli/ardia-cli-install.sh", "755"],
    ["usr/lib/ardia/cli/ardia-cli-1.2.3-linux-x64.tar.gz", "644"],
    ["usr/lib/ardia/cli/ardia-cli.sha256", "644"],
  ]);
});

test("appVersion passes on the package version, is old on Chromium's and fails on anything else", () => {
  assert.equal(appVersionVerdict("0.2.44", "0.2.44").status, "pass");
  assert.equal(appVersionVerdict("0.2.44", "156.0.8078.79").status, "old");
  assert.equal(appVersionVerdict("0.2.44", "0.2.43").status, "fail");
  assert.equal(appVersionVerdict("0.2.44", undefined).status, "fail");
});

test("CLI control is supported when the host advertises any of its methods", () => {
  assert.deepEqual(cliControlSupport(["engine.systemState"]), []);
  assert.deepEqual(cliControlSupport(null), []);
  assert.deepEqual(cliControlSupport(["ArdiaAutomation.start", "engine.setCliControl"]), ["engine.setCliControl", "ArdiaAutomation.start"]);
});

test("the CLI-control launch swaps the DevTools port for the pipe and stays within the smoke's launch rules", () => {
  const args = pipeLaunchArguments(launchArguments({ scratch: "/tmp/p" }));
  assert.ok(args.includes("--remote-debugging-pipe"));
  assert.ok(!args.some((arg) => arg.startsWith("--remote-debugging-port") || arg.startsWith("--remote-debugging-address")));
  assert.equal(launchRefusal(args, launchEnvironment({ scratch: "/tmp/p", base: { PATH: "/usr/bin" } })), null);
});

test("pipe messages split on NUL and keep a partial tail", () => {
  const { messages, rest } = splitPipeMessages(Buffer.from('{"id":1,"result":{}}\0{"id":2,"result":{"a":1}}\0{"id":3'));
  assert.deepEqual(messages, [{ id: 1, result: {} }, { id: 2, result: { a: 1 } }]);
  assert.equal(rest.toString(), '{"id":3');
});

test("a second install is a no-op only when it neither downloads, verifies nor installs", () => {
  assert.equal(installerRanAgain("step resolve\nversion 1.2.3\ninstalled /h/.local/bin/ardia\n"), false);
  assert.equal(installerRanAgain("step resolve\nversion 1.2.3\nstep download\nstep verify\nstep install\ninstalled /x\n"), true);
});

test("skipped and old-engine checks pass the gate but show what they are; an old engine fails without the flag", () => {
  const rows = ASSERTIONS.map((name) => ({ name, ok: true, detail: null, ms: 1 }));
  rows[8] = { name: "app-version", ok: true, status: "skip", detail: { reason: "a dev package: no lib/ardia/VERSION" }, ms: 0 };
  rows[10] = { name: "cli-control", ok: true, status: "old", detail: { reason: "the engine predates CLI control" }, ms: 0 };
  assert.equal(summarize(rows).ok, true);
  const table = formatTable(rows);
  assert.match(table, /^skip {2}app-version .*a dev package/m);
  assert.match(table, /^old {3}cli-control .*predates CLI control/m);
  rows[10] = { name: "cli-control", ok: false, status: "old", detail: { error: "the engine predates CLI control (--allow-old-engine accepts this)" }, ms: 0 };
  assert.equal(summarize(rows).ok, false);
  assert.match(formatTable(rows), /^FAIL {2}cli-control/m);
});
