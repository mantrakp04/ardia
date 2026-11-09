import assert from "node:assert/strict";
import { test } from "node:test";
const { callerLabel, parseCliCaller } = await import("./cliCaller.ts");

test("a caller's name is display text: invisible and control characters go, spaces fold, 40 characters at most", () => {
  assert.deepEqual(parseCliCaller({ name: "  T3\u0000 Code\u200b\n(Nightly)\u202e ", app: "/Applications/T3 Code (Nightly).app" }), {
    name: "T3 Code (Nightly)",
    app: "/Applications/T3 Code (Nightly).app",
  });
  assert.equal(parseCliCaller({ name: "x".repeat(100) }).name, "x".repeat(40));
  assert.equal(parseCliCaller({ name: "🙂".repeat(41) }).name, "🙂".repeat(40));
  assert.equal(parseCliCaller({ name: "\u200b\n " }), null);
  assert.equal(parseCliCaller({ name: 7 }), null);
  assert.equal(parseCliCaller("Claude Code"), null);
  assert.equal(parseCliCaller(null), null);
});

test("only an absolute, outermost .app bundle path is kept for the icon", () => {
  const app = (path) => parseCliCaller({ name: "A", app: path }).app;
  assert.equal(app("/Applications/Ghostty.app"), "/Applications/Ghostty.app");
  assert.equal(app("Applications/Ghostty.app"), null);
  assert.equal(app("/Applications/Code.app/Contents/Frameworks/Code Helper.app"), null);
  assert.equal(app("/Applications/../Users/me/Evil.app"), null);
  assert.equal(app("/etc/passwd"), null);
  assert.equal(app(`/${"a".repeat(1100)}.app`), null);
  assert.equal(app(undefined), null);
});

test("no caller reads as the ardia command", () => {
  assert.equal(callerLabel(null), "ardia");
  assert.equal(callerLabel({ name: "Codex", app: null }), "Codex");
});
