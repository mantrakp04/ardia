import assert from "node:assert/strict";
import test from "node:test";
import { BROWSER_WINDOW_COMMANDS, regularFocusOrder, routeToBrowserWindow, serveBrowserCommands } from "./browserCommandRoute.ts";

const name = `route-test-${process.pid}`;

function browserRenderer(windowId, focus) {
  const channel = new BroadcastChannel(name);
  const ran = [];
  const focused = [];
  const served = serveBrowserCommands({ windowId, channel, order: () => focus.order, run: (id, command) => ran.push([id, command]), focus: async (id) => focused.push(id) });
  return { ran, focused, close: () => { served.remove(); channel.close(); } };
}

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

test("a utility window's browser command runs once, in the first regular window of the browser windows' focus order", async () => {
  const focus = { order: ["w2", "w1", "w3"] };
  const renderers = ["w1", "w2", "w3"].map((id) => browserRenderer(id, focus));
  const settings = new BroadcastChannel(name);
  try {
    assert.equal(await routeToBrowserWindow({ channel: settings, command: "showOnboarding", gatherMs: 50 }), "w2");
    await settle();
    assert.deepEqual(renderers.map((r) => r.ran), [[], [["w2", "showOnboarding"]], []]);
    assert.deepEqual(renderers[1].focused, ["w2"]);
    focus.order = ["w3", "w2", "w1"];
    assert.equal(await routeToBrowserWindow({ channel: settings, command: "toolTour", gatherMs: 50 }), "w3");
    await settle();
    assert.deepEqual(renderers[2].ran, [["w3", "toolTour"]]);
    assert.equal(renderers.flatMap((r) => r.ran).length, 2);
  } finally {
    renderers.forEach((r) => r.close());
    settings.close();
  }
});

test("a focused window that doesn't serve (a private window, or one still loading) is skipped for the next regular one", async () => {
  const focus = { order: ["w-private", "w1"] };
  const renderer = browserRenderer("w1", focus);
  const settings = new BroadcastChannel(name);
  try {
    assert.equal(await routeToBrowserWindow({ channel: settings, command: "showOnboarding", gatherMs: 50 }), "w1");
    await settle();
    assert.deepEqual(renderer.ran, [["w1", "showOnboarding"]]);
  } finally {
    renderer.close();
    settings.close();
  }
});

test("the focus order keeps only regular, non-Little-Ardia windows", () => {
  const state = {
    ui: { focusOrder: ["p", "small", "b", "gone"] },
    windowOrder: ["a", "b", "p", "small"],
    windows: { a: { kind: "main" }, b: { kind: "main" }, p: { kind: "private" }, small: { kind: "small" } },
  };
  assert.deepEqual(regularFocusOrder(state), ["b", "a"]);
});

test("with no browser window serving the route answers null instead of pretending it ran", async () => {
  const settings = new BroadcastChannel(name);
  try {
    assert.equal(await routeToBrowserWindow({ channel: settings, command: "showOnboarding", gatherMs: 30 }), null);
  } finally {
    settings.close();
  }
});

test("browser windows refuse routed commands that aren't browser-window help commands", async () => {
  const renderer = browserRenderer("w1", { order: ["w1"] });
  const settings = new BroadcastChannel(name);
  try {
    assert.equal(BROWSER_WINDOW_COMMANDS.has("quit"), false);
    assert.equal(await routeToBrowserWindow({ channel: settings, command: "quit", gatherMs: 30, answerMs: 100 }), null);
    await settle();
    assert.deepEqual(renderer.ran, []);
  } finally {
    renderer.close();
    settings.close();
  }
});

test("a claim that arrives after the utility gave up is never told to run, so there is exactly one answer", async () => {
  const late = new BroadcastChannel(name);
  const watcher = new BroadcastChannel(name);
  const settings = new BroadcastChannel(name);
  const seen = [];
  watcher.addEventListener("message", ({ data }) => seen.push(data.type));
  late.addEventListener("message", ({ data }) => {
    if (data.type === "find") late.postMessage({ type: "here", request: data.request, windowId: "w1", order: ["w1"] });
    if (data.type === "run") setTimeout(() => late.postMessage({ type: "claim", request: data.request, windowId: "w1" }), 80);
  });
  try {
    assert.equal(await routeToBrowserWindow({ channel: settings, command: "showOnboarding", gatherMs: 20, answerMs: 20 }), null);
    await settle(150);
    assert.ok(seen.includes("claim"));
    assert.equal(seen.includes("go"), false);
  } finally {
    late.close();
    watcher.close();
    settings.close();
  }
});

test("a window that claimed but never heard go drops the claim and runs nothing", async () => {
  const channel = new BroadcastChannel(name);
  const driver = new BroadcastChannel(name);
  const ran = [];
  const served = serveBrowserCommands({ windowId: "w1", channel, order: () => ["w1"], run: (...args) => ran.push(args), focus: async () => {}, claimMs: 30 });
  try {
    driver.postMessage({ type: "run", request: "r1", windowId: "w1", command: "showOnboarding" });
    await settle(60);
    driver.postMessage({ type: "go", request: "r1", windowId: "w1" });
    await settle();
    assert.deepEqual(ran, []);
  } finally {
    served.remove();
    channel.close();
    driver.close();
  }
});
