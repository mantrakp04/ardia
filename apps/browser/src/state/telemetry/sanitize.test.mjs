import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanProperties, errorCode, errorMessage, errorType, nativeCrashExceptions, nativeFrames, parseStack, scrubText } from "./sanitize.ts";

const leaks = (text, ...secrets) => secrets.filter((s) => text.includes(s));

test("web addresses, hosts and app URLs are stripped", () => {
  const out = scrubText(
    "Failed to load https://mail.example.com/inbox?q=secret#frag, then ardia://settings/passwords and chrome://version from bank.co.uk:8443",
  );
  assert.deepEqual(leaks(out, "example", "inbox", "secret", "passwords", "settings", "version", "bank"), []);
  assert.match(out, /^Failed to load <url> then <url> and <url> from <host>$/);
  assert.equal(scrubText("blob:https://x.test/abc data:text/html,<h1>hi</h1> about:blank"), "<url> <url> <url>");
  assert.equal(scrubText("visit www.secret-site.io now"), "visit <host> now");
  assert.equal(scrubText("dev server at localhost:8081 and 192.168.1.20:3000"), "dev server at <host> and <ip>");
});

test("file paths and file names are stripped, with the user's name", () => {
  const out = scrubText("Couldn't read /Users/alice/Library/Application Support/Ardia/history.json");
  assert.deepEqual(leaks(out, "alice", "Library", "Ardia", "history"), []);
  assert.ok(out.startsWith("Couldn't read <path>"));
  assert.equal(scrubText("Couldn't save live-folders-work.json"), "Couldn't save <file>");
  assert.equal(scrubText("open ~/Documents/Taxes 2025.pdf failed"), "open <path> <file> failed");
  assert.equal(scrubText("see ./relative/dir/file and C/D"), "see <path> and <path>");
  assert.deepEqual(leaks(scrubText("file:///Users/bob/Desktop/plan.docx"), "bob", "plan"), []);
});

test("quoted text, emails, ids and long numbers are stripped", () => {
  assert.equal(scrubText(`Profile "Bob's Work" not found`), "Profile <text>");
  assert.equal(scrubText("Cannot read property 'password' of undefined"), "Cannot read property <text>");
  assert.equal(scrubText("mail alice.smith+x@corp.example.org"), "mail <email>");
  assert.equal(scrubText("tab 3f2c1a9e-1b2c-4d5e-8f90-123456789abc gone"), "tab <id> gone");
  assert.equal(scrubText("card 4111111111111111 declined"), "card <n> declined");
  assert.equal(scrubText("Couldn't save the sync state; can't retry"), "Couldn't save the sync state; can't retry");
});

test("Hermes stacks keep function and bundle names, not the dev host, query or directories", () => {
  const stack = [
    "TypeError: boom",
    "    at choose (http://localhost:8081/index.bundle//&platform=macos&dev=true&minify=false:123:45)",
    "    at anonymous (address at /Users/alice/Library/Developer/Xcode/DerivedData/main.jsbundle:1:9876)",
    "    at apply (native)",
    "    at ?anon_0_ (index.bundle:1:2)",
  ].join("\n");
  const frames = parseStack(stack);
  const json = JSON.stringify(frames);
  assert.deepEqual(leaks(json, "localhost", "8081", "platform=macos", "alice", "DerivedData", "Users"), []);
  assert.equal(frames.at(-1).function, "choose");
  assert.equal(frames.at(-1).filename, "index.bundle");
  assert.equal(frames.at(-1).lineno, 123);
  assert.equal(frames.at(-1).colno, 45);
  assert.equal(frames.at(-2).filename, "main.jsbundle");
  assert.equal(frames.at(-3).filename, "native");
  assert.equal(frames.at(-3).in_app, false);
  for (const f of frames) assert.equal(f.platform, "custom");
});

test("event properties are flat, plain and scrubbed", () => {
  const out = cleanProperties({
    kind: "history",
    count: 3,
    ok: true,
    none: null,
    nan: NaN,
    url: "https://secret.test/path",
    nested: { url: "https://x.test" },
    list: ["a"],
    "bad key": 1,
  });
  assert.deepEqual(out, { kind: "history", count: 3, ok: true, none: null, url: "<url>" });
});

test("an uncaught NSException sends its name, a scrubbed reason and its throw site first", () => {
  const { name, signal, reason, exceptions } = nativeCrashExceptions({
    exceptionType: "EXC_BREAKPOINT",
    signal: "SIGTRAP",
    exceptionName: "NSRangeException",
    exceptionReason:
      "*** -[TabStrip select:]: index 3 beyond bounds for https://private.example/a?q=1 in /Users/someone/Library/x.json by me@example.com, id 0123456789abcdef0123\nsecond line",
    frames: [{ image: "AppKit", symbol: "+[NSApplication _crashOnException:]", offset: 0x3d5e74 }, { image: "Ardia", symbol: "main", offset: 0x4a10, symbolOffset: 8 }],
    exceptionFrames: [
      { image: "CoreFoundation", symbol: "__exceptionPreprocess", offset: 0x1007b0 },
      { image: "libobjc.A.dylib", symbol: "objc_exception_throw", offset: 0x165c },
      { image: "ArdiaShell", symbol: "TabStrip.select(_:)", offset: 0x2010, symbolOffset: 40 },
    ],
  });
  assert.equal(name, "NSRangeException");
  assert.equal(signal, "SIGTRAP");
  assert.equal(reason, "*** -[TabStrip select:]: index 3 beyond bounds for <url> in <path> by <email>, id <hex>");
  assert.deepEqual(exceptions.map((e) => [e.type, e.value]), [
    ["NSRangeException", reason],
    ["EXC_BREAKPOINT", "EXC_BREAKPOINT (SIGTRAP)"],
  ]);
  assert.equal(exceptions[0].frames.at(-1).function, "__exceptionPreprocess");
  assert.equal(exceptions[0].frames[0].function, "TabStrip.select(_:)");
  assert.equal(exceptions[0].frames[0].image_offset, "0x2010");
  assert.equal(exceptions[0].frames[0].in_app, true);
  assert.equal(exceptions[1].frames.at(-1).function, "+[NSApplication _crashOnException:]");
  assert.equal(exceptions[1].frames.at(-1).image_offset, "0x3d5e74");
});

test("an exception without a name or reason still says what it was", () => {
  const { name, reason, subtype, exceptions } = nativeCrashExceptions({
    exceptionType: "EXC_BAD_ACCESS",
    signal: "SIGBUS",
    exceptionSubtype: "EXC_ARM_DA_ALIGN",
    frames: [{ image: "libsystem_platform.dylib", symbol: "_platform_memmove", offset: 0x1100 }],
    exceptionFrames: [{ image: "libobjc.A.dylib", symbol: "objc_exception_throw", offset: 0x165c }],
  });
  assert.equal(name, null);
  assert.equal(reason, null);
  assert.equal(subtype, "EXC_ARM_DA_ALIGN");
  assert.equal(nativeCrashExceptions({ frames: [], exceptionSubtype: "at 0x4f776f646168732f" }).subtype, null);
  assert.deepEqual(exceptions.map((e) => [e.type, e.value]), [
    ["NSException", "Uncaught NSException"],
    ["EXC_BAD_ACCESS", "EXC_BAD_ACCESS (SIGBUS)"],
  ]);
});

test("native frames keep their image offset and drop a stripped image's nearest export", () => {
  const frames = nativeFrames([
    { image: "Chromium Framework", symbol: "ArdiaCoreMain", symbolOffset: 66417332, offset: 0x41a36e8 },
    { image: "Chromium Framework", symbol: "ac_engine_abi_version", offset: 0x2139600 },
    { image: "Chromium Framework", symbol: "ArdiaCoreMain", symbolOffset: 760, offset: 0x442c72c },
    { image: "Chromium Framework", offset: 0x2ef170 },
    { image: "Ardia", offset: 0x3fd9f0 },
    { image: "CoreAutoLayout", symbol: "_NSBitSetResize", symbolOffset: 120000, offset: 0x9a10 },
    { image: "/Users/someone/Ardia.app/Contents/MacOS/Ardia", symbol: "-[X open:/Users/someone/a]", symbolOffset: 4, offset: 16 },
  ]).reverse();
  assert.deepEqual(
    frames.map((f) => [f.function, f.image_offset, f.resolved]),
    [
      ["Chromium Framework + 0x41a36e8", "0x41a36e8", false],
      ["Chromium Framework + 0x2139600", "0x2139600", false],
      ["ArdiaCoreMain", "0x442c72c", true],
      ["Chromium Framework + 0x2ef170", "0x2ef170", false],
      ["Ardia + 0x3fd9f0", "0x3fd9f0", false],
      ["_NSBitSetResize", "0x9a10", true],
      ["-[X <path>", "0x10", true],
    ],
  );
  assert.equal(frames[6].module, "Ardia");
  assert.deepEqual(frames.map((f) => f.in_app), [true, true, true, true, true, false, true]);
});

test("crash reports name only the app's own images, by UUID", () => {
  const { images } = nativeCrashExceptions({
    frames: [],
    images: [
      { name: "Ardia", uuid: "1C77EF99-77D4-3DE8-9BA2-6929E276BC60" },
      { name: "Chromium Framework", uuid: "4c4c4479-5555-3144-a199-a2cbd9a6d85f" },
      { name: "AppKit", uuid: "77e3adb8-e4e8-3912-8599-d43182877c10" },
      { name: "Ardia", uuid: "not a uuid" },
      { name: "/Users/someone/evil", uuid: "4c4c4479-5555-3144-a199-a2cbd9a6d85f" },
    ],
  });
  assert.deepEqual(images, [
    { name: "Ardia", uuid: "1c77ef99-77d4-3de8-9ba2-6929e276bc60" },
    { name: "Chromium Framework", uuid: "4c4c4479-5555-3144-a199-a2cbd9a6d85f" },
  ]);
});

test("a quoted span cut off by a length limit is still redacted, through the end of the line", () => {
  const cut = `Unhandled JS Exception: "private patient history ${"x".repeat(700)}`;
  assert.equal(scrubText(cut, 300), "Unhandled JS Exception: <text>");
  assert.equal(scrubText("refused 'secret project plans"), "refused <text>");
  assert.equal(scrubText("it's the user's tab"), "it's the user's tab");
  const { reason } = nativeCrashExceptions({ frames: [], exceptionFrames: [{ image: "Ardia", offset: 1 }], exceptionReason: cut });
  assert.equal(reason, "Unhandled JS Exception: <text>");
});

test("a named exception without a thrown backtrace still sends its name and reason", () => {
  const { exceptions } = nativeCrashExceptions({
    exceptionType: "EXC_CRASH",
    signal: "SIGABRT",
    exceptionName: "NSInternalInconsistencyException",
    exceptionReason: "window not ready",
    frames: [{ image: "AppKit", symbol: "-[NSWindow display]", offset: 0x10 }],
    exceptionFrames: [],
  });
  assert.deepEqual(exceptions.map((e) => [e.type, e.value, e.frames.length]), [
    ["NSInternalInconsistencyException", "window not ready", 0],
    ["EXC_CRASH", "EXC_CRASH (SIGABRT)", 1],
  ]);
});

test("an unclosed quote holding an apostrophe is redacted; an apostrophe inside a word isn't a closing quote", () => {
  assert.equal(scrubText("refused 'patient's private medical history\ncontinued"), "refused <text>");
  assert.equal(scrubText("x ‘Ana’s private notes"), "x <text>");
  assert.equal(scrubText("'patient's file' was locked"), "<text>");
  assert.equal(scrubText("x ‘Ana’s notes’ y"), "x <text>");
  assert.equal(scrubText("Don't 'quote' the user's tab"), "Don't <text>");
});

test("an apostrophe between non-Latin letters never closes a quote, so the rest of the line is redacted", () => {
  assert.equal(scrubText("refused ‘ім’я пацієнта та медична історія"), "refused <text>");
  assert.equal(scrubText("refused ‘του’ασθενούς ιστορικό"), "refused <text>");
  assert.equal(scrubText("refused ‘患’者の病歴"), "refused <text>");
  assert.equal(scrubText("refused 'ім'я пацієнта"), "refused <text>");
  assert.equal(scrubText("refused \"患\"者の病歴"), "refused <text>");
  assert.equal(scrubText("x ‘Ana’s notes’ y"), "x <text>");
});

test("everything from the first quote to the end of the line is redacted, whatever the quotes", () => {
  assert.equal(scrubText('refused "ok"—‘patient" private medical history'), "refused <text>");
  assert.equal(scrubText("it's the user's tab, don't “mix” them"), "it's the user's tab, don't <text>");
  assert.equal(scrubText("closing ” first, then private"), "closing <text>");
  assert.equal(scrubText("(’patient’s history"), "(<text>");
});

test("scrubbing a long reason full of quotes takes linear time", () => {
  const reason = '"a'.repeat(32768);
  const started = performance.now();
  assert.equal(scrubText(reason, 300), "<text>");
  assert.equal(scrubText(`x ${"'a".repeat(32768)}`, 300), "x <text>");
  assert.ok(performance.now() - started < 10, `${performance.now() - started} ms`);
});

test("a reason cut to length drops its last, partial word instead of leaking half of it", () => {
  const out = scrubText(`${"word ".repeat(59)}patient.name@private-clinic.example.org trailing`, 300);
  assert.ok(!/patient|private|@/.test(out), out);
  assert.ok(out.endsWith("word…"), out);
});
