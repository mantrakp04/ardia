import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { appInfo, docs } from "../../browser/src/test-native/index.ts";
import { useBrowser } from "../../browser/src/state/browser/store.ts";
import { useOnboarding, onboardingCompletedAt } from "../../browser/src/state/onboarding/onboarding.ts";
import { useToasts } from "../../browser/src/state/app/toasts.ts";
import { APP_LAUNCH_LOCK, APP_LAUNCH_MARK, FRESH_PROFILE_DOCUMENT, LAUNCH_STEPS, UTILITY_APP_COMMANDS, claimAppLaunch, hostLaunchRecord, onboardingAction, recordFreshProfile, runAppCommand, runLaunchServices, serveUtilityCommands, startAppCommands } from "./appServices.ts";

const capabilities = { defaultBrowser: false, launchAtLogin: false, thinScrollBars: false, webkit: false, cliControl: false, externalLinks: false, performanceRecording: false, taskManager: false };

function lockManager() {
  const queue = [];
  let holder = null;
  const grant = () => {
    if (holder || !queue.length) return;
    holder = queue.shift();
    Promise.resolve().then(() => holder.callback()).then(holder.resolve, holder.reject).finally(() => {
      if (holder?.alive) { holder = null; grant(); }
    });
  };
  return {
    requests: () => queue.length + (holder ? 1 : 0),
    holderWindow: () => holder?.window ?? null,
    killHolder() {
      if (!holder) return;
      holder.alive = false;
      holder = null;
      grant();
    },
    forWindow(window) {
      return {
        request(name, callback) {
          assert.equal(name, APP_LAUNCH_LOCK);
          return new Promise((resolve, reject) => {
            queue.push({ window, callback, resolve, reject, alive: true });
            grant();
          });
        },
      };
    },
  };
}

function launchRecord(initial = []) {
  const done = new Set(initial);
  const completions = [];
  return {
    done: async () => new Set(done),
    complete: async (step) => { completions.push(step); done.add(step); },
    steps: done,
    completions,
  };
}

const stored = (files) => async (name) => files[name] ?? null;

function twoWindows() {
  useBrowser.setState(useBrowser.getInitialState(), true);
  useOnboarding.setState({ windowId: null, step: "intro" });
  docs.clear();
  const first = useBrowser.getState().createWindow({ url: "https://one.example/" });
  const second = useBrowser.getState().createWindow({ url: "https://two.example/" });
  return { first, second };
}

const launch = (windowId, overrides = {}) => {
  const record = overrides.record ?? launchRecord();
  return runLaunchServices({
    windowId,
    savedSession: false,
    capabilities,
    done: overrides.done ?? new Set(),
    complete: record.complete,
    readStored: stored(Object.fromEntries(docs)),
    ...overrides,
  }).then(() => record);
};

const toast = (windowId) => useToasts.getState().toasts[windowId];

test("onboarding decisions use evidence that predates this launch and never guess", () => {
  const action = (onboarding, freshProfile, savedSession) => onboardingAction({ onboarding, freshProfile, savedSession });
  assert.equal(action("present", "absent", true), "shared");
  assert.equal(action("absent", "absent", false), "shared");
  assert.equal(action("absent", "present", true), "shared");
  assert.equal(action("absent", "absent", true), "complete");
  assert.equal(action("unknown", "present", true), "skip");
  assert.equal(action("absent", "unknown", true), "skip");
});

test("a fresh profile whose first launch never recorded onboarding is still onboarded on the next launch", async () => {
  const { second } = twoWindows();
  docs.set(FRESH_PROFILE_DOCUMENT, JSON.stringify({ version: 1, createdAt: 1 }));
  await launch(second, { savedSession: true });
  assert.equal(useOnboarding.getState().windowId, second);
  assert.equal(onboardingCompletedAt(), null);
});

test("the fresh-profile marker is saved before the first session flush and only for a profile with no saved session", async () => {
  const writes = [];
  await recordFreshProfile(async (name, contents) => { writes.push([name, JSON.parse(contents)]); });
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], FRESH_PROFILE_DOCUMENT);
  assert.equal(writes[0][1].version, 1);
  await recordFreshProfile(async () => { throw new Error("disk full"); });
  const main = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
  const marker = main.indexOf("if (!saved) await recordFreshProfile();");
  assert.ok(marker > 0 && marker < main.indexOf("await persistence.flush();"));
});

test("an onboarding record dropped from the bootstrap snapshot is never overwritten or restarted", async () => {
  const { first } = twoWindows();
  const record = JSON.stringify({ completedAt: null, startedAt: 5, defaultBrowserTrialStartedAt: 9, version: 1 });
  await launch(first, { savedSession: true, readStored: stored({ "onboarding.json": record }) });
  assert.equal(docs.has("onboarding.json"), false);
  assert.equal(useOnboarding.getState().windowId, null);
  await launch(first, { savedSession: true, readStored: async () => { throw new Error("read failed"); } });
  assert.equal(docs.has("onboarding.json"), false);
});

test("a pre-existing Linux profile with no onboarding history is marked complete only when the record is truly absent", async () => {
  const { first } = twoWindows();
  await launch(first, { savedSession: true });
  assert.equal(useOnboarding.getState().windowId, null);
  assert.equal(typeof onboardingCompletedAt(), "number");
});

test("a fresh profile starts onboarding once, in the owning window, and records each launch step", async () => {
  const { second } = twoWindows();
  appInfo.appVersion = "2.0";
  const record = await launch(second);
  assert.equal(useOnboarding.getState().windowId, second);
  const saved = JSON.parse(docs.get("onboarding.json"));
  assert.equal(saved.completedAt, null);
  assert.equal(typeof saved.startedAt, "number");
  assert.equal(JSON.parse(docs.get("release-notes.json")).lastVersion, "2.0");
  assert.deepEqual(record.completions, ["version", "onboarding", "releaseNotes", "defaultBrowserOffer"]);
});

test("completed onboarding stays finished and an interrupted one resumes in the owning window", async () => {
  const { first, second } = twoWindows();
  await launch(first);
  const started = docs.get("onboarding.json");
  useOnboarding.setState({ windowId: null });
  await launch(second, { savedSession: true });
  assert.equal(useOnboarding.getState().windowId, second);
  assert.equal(JSON.parse(docs.get("onboarding.json")).startedAt, JSON.parse(started).startedAt);
  docs.set("onboarding.json", JSON.stringify({ completedAt: 1, startedAt: 1, version: 1 }));
  useOnboarding.setState({ windowId: null });
  await launch(first);
  assert.equal(useOnboarding.getState().windowId, null);
});

test("launch services run once per process even with several windows and reloads", async () => {
  const locks = lockManager();
  const record = launchRecord();
  let runs = 0;
  const run = async (done) => { runs++; for (const step of LAUNCH_STEPS) if (!done.has(step)) await record.complete(step); };
  const claims = await Promise.all(["a", "b", "c"].map((window) => claimAppLaunch({ locks: locks.forWindow(window), record, run })));
  assert.deepEqual(claims.sort(), ["alreadyDone", "alreadyDone", "ran"]);
  assert.equal(runs, 1);
  assert.equal(await claimAppLaunch({ locks: locks.forWindow("a-reloaded"), record, run }), "alreadyDone");
  assert.equal(runs, 1);
});

test("if the owning window closes mid-launch another window finishes only the remaining steps", async () => {
  const locks = lockManager();
  const record = launchRecord();
  const ran = [];
  let reached;
  const reachedVersion = new Promise((resolve) => { reached = resolve; });
  const owner = claimAppLaunch({
    locks: locks.forWindow("startup"),
    record,
    run: async () => { ran.push(["startup", "version"]); await record.complete("version"); reached(); await new Promise(() => {}); },
  });
  const survivor = claimAppLaunch({
    locks: locks.forWindow("restored"),
    record,
    run: async (done) => { for (const step of LAUNCH_STEPS) if (!done.has(step)) { ran.push(["restored", step]); await record.complete(step); } },
  });
  await reachedVersion;
  assert.equal(locks.holderWindow(), "startup");
  locks.killHolder();
  assert.equal(await survivor, "ran");
  assert.deepEqual(ran, [["startup", "version"], ["restored", "onboarding"], ["restored", "releaseNotes"], ["restored", "defaultBrowserOffer"]]);
  void owner;
});

test("a takeover window restores the pending release-notes postcard and opens notes still due", async () => {
  const { first } = twoWindows();
  appInfo.appVersion = "3.0";
  docs.set("release-notes.json", JSON.stringify({ lastVersion: "3.0", pending: null, version: 1 }));
  docs.set("onboarding.json", JSON.stringify({ completedAt: 1, version: 1 }));
  const record = await launch(first, { done: new Set(["version", "versionUpdated"]), savedSession: true });
  assert.deepEqual(record.completions, ["onboarding", "releaseNotes", "defaultBrowserOffer"]);
});

test("without an election primitive or launch record no window claims the app-wide services", async () => {
  let runs = 0;
  assert.equal(await claimAppLaunch({ record: launchRecord(), run: async () => { runs++; } }), "unavailable");
  assert.equal(await claimAppLaunch({ locks: lockManager().forWindow("a"), run: async () => { runs++; } }), "unavailable");
  const failing = { request: () => Promise.reject(new Error("locks unavailable")) };
  assert.equal(await claimAppLaunch({ locks: failing, record: launchRecord(), run: async () => { runs++; } }), "unavailable");
  assert.equal(runs, 0);
});

test("a launch step that throws releases the lease for a retry instead of reporting success", async () => {
  const locks = lockManager();
  assert.equal(await claimAppLaunch({ locks: locks.forWindow("a"), record: launchRecord(), run: async () => { throw new Error("boom"); } }), "failed");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(locks.requests(), 0);
});

test("the host launch record reads and completes steps through the native host", async () => {
  const calls = [];
  const host = {
    bootstrap: { windowId: "w", profileId: "default", capabilities: ["ArdiaShell.launchSteps", "ArdiaShell.completeLaunchStep"] },
    invoke: async (method, args) => { calls.push([method, args]); return method === "ArdiaShell.launchSteps" ? ["version"] : true; },
  };
  const record = hostLaunchRecord(host);
  assert.deepEqual([...(await record.done())], ["version"]);
  await record.complete("onboarding");
  assert.deepEqual(calls, [["ArdiaShell.launchSteps", { args: [] }], ["ArdiaShell.completeLaunchStep", { args: ["onboarding"] }]]);
  assert.equal(hostLaunchRecord({ bootstrap: { capabilities: [] } }), undefined);
});

test("app commands run only in the window that issued them", () => {
  const { first, second } = twoWindows();
  const listeners = [];
  const subscription = startAppCommands(first, capabilities, (listener) => (listeners.push(listener), { remove() {} }));
  assert.ok(subscription);
  listeners[0]({ command: "showOnboarding", windowId: second });
  assert.equal(useOnboarding.getState().windowId, null);
  listeners[0]({ command: "showOnboarding" });
  assert.equal(useOnboarding.getState().windowId, null);
  listeners[0]({ command: "showOnboarding", windowId: first });
  assert.equal(useOnboarding.getState().windowId, first);
});

test("unavailable help and developer commands say so instead of failing silently", () => {
  const { first } = twoWindows();
  for (const command of ["taskManager", "recordPerformanceIssue", "releaseNotes", "videoTour"]) {
    useToasts.setState({ toasts: {} });
    assert.equal(runAppCommand(first, command, capabilities), true, command);
    assert.equal(toast(first)?.title, "Not available on Linux yet", command);
  }
  assert.equal(runAppCommand(first, "newTab", capabilities), false);
});

test("Send Feedback copies the report and says where it went when no mail app can open", async () => {
  const { first } = twoWindows();
  useToasts.setState({ toasts: {} });
  runAppCommand(first, "sendFeedback", capabilities);
  for (let i = 0; i < 20 && !toast(first); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(toast(first)?.title, "Feedback report copied");
});

test("utility windows run only the app commands that need no browser window", () => {
  const { first } = twoWindows();
  const listeners = [];
  startAppCommands("settings", capabilities, (listener) => (listeners.push(listener), { remove() {} }), UTILITY_APP_COMMANDS);
  assert.deepEqual([...UTILITY_APP_COMMANDS].sort(), ["copyDiagnostics", "quit", "recordPerformanceIssue", "taskManager"]);
  useToasts.setState({ toasts: {} });
  listeners[0]({ command: "taskManager", windowId: "settings" });
  assert.equal(toast("settings")?.title, "Not available on Linux yet");
  assert.equal(toast(first), undefined);
});

test("Show Onboarding pressed in Settings plays in the most recently focused regular browser window, not in Settings", async () => {
  const { first, second } = twoWindows();
  useBrowser.setState((s) => ({ ui: { ...s.ui, focusOrder: [second, first] } }));
  const name = `app-route-${process.pid}`;
  const channels = [new BroadcastChannel(name), new BroadcastChannel(name), new BroadcastChannel(name)];
  const focused = [];
  const served = [first, second].map((windowId, index) => serveUtilityCommands({ windowId, capabilities, privateWindow: false, channel: () => channels[index], focus: async (id) => focused.push(id) }));
  const listeners = [];
  startAppCommands("settings", capabilities, (listener) => (listeners.push(listener), { remove() {} }), UTILITY_APP_COMMANDS, () => channels[2]);
  try {
    useToasts.setState({ toasts: {} });
    listeners[0]({ command: "showOnboarding", windowId: "settings" });
    for (let i = 0; i < 100 && !useOnboarding.getState().windowId; i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(useOnboarding.getState().windowId, second);
    assert.deepEqual(focused, [second]);
    assert.equal(toast("settings"), undefined);
  } finally {
    served.forEach((entry) => entry.remove());
    channels.forEach((channel) => channel.close());
  }
});

test("private browser windows never serve Settings' help commands", () => {
  const { first } = twoWindows();
  let opened = 0;
  assert.equal(serveUtilityCommands({ windowId: first, capabilities, privateWindow: true, channel: () => (opened++, null) }), null);
  assert.equal(opened, 0);
  const source = readFileSync(new URL("./appServices.ts", import.meta.url), "utf8");
  assert.match(source, /serveUtilityCommands\(\{ windowId, capabilities, privateWindow: !!host\.bootstrap\.privateWindow \}\)/);
});


test("a browser-window command from Settings with no browser window says so", async () => {
  twoWindows();
  const settingsChannel = new BroadcastChannel(`app-route-empty-${process.pid}`);
  const listeners = [];
  startAppCommands("settings", capabilities, (listener) => (listeners.push(listener), { remove() {} }), UTILITY_APP_COMMANDS, () => settingsChannel);
  try {
    useToasts.setState({ toasts: {} });
    listeners[0]({ command: "toolTour", windowId: "settings" });
    for (let i = 0; i < 100 && !toast("settings"); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(toast("settings")?.title, "No browser window to show this in");
  } finally {
    settingsChannel.close();
  }
});

test("only the renderer that runs launch steps leaves the evidence mark", async () => {
  const locks = lockManager();
  const record = launchRecord();
  const marks = [new Map(), new Map()];
  const storage = (map) => ({ getItem: (key) => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value) });
  const run = async (done) => { for (const step of LAUNCH_STEPS) if (!done.has(step)) await record.complete(step); };
  await claimAppLaunch({ locks: locks.forWindow("a"), record, run, marks: storage(marks[0]) });
  await claimAppLaunch({ locks: locks.forWindow("b"), record, run, marks: storage(marks[1]) });
  assert.equal(marks[0].get(APP_LAUNCH_MARK), "ran");
  assert.equal(marks[1].get(APP_LAUNCH_MARK), undefined);
});

test("release notes still open when the holder died between recording versionUpdated and version", async () => {
  const { first } = twoWindows();
  appInfo.appVersion = "4.0";
  appInfo.releaseNotesURL = "https://ardia.dev/release-notes";
  appInfo.forceReleaseNotes = true;
  docs.set("release-notes.json", JSON.stringify({ lastVersion: "4.0", pending: null, version: 1 }));
  docs.set("onboarding.json", JSON.stringify({ completedAt: 1, version: 1 }));
  try {
    const record = await launch(first, { done: new Set(["versionUpdated"]), savedSession: true });
    assert.deepEqual(record.completions, ["version", "onboarding", "releaseNotes", "defaultBrowserOffer"]);
    assert.ok(Object.values(useBrowser.getState().tabs).some((tab) => (tab.url ?? tab.navigation?.url ?? "").startsWith("https://ardia.dev/release-notes")));
  } finally {
    delete appInfo.releaseNotesURL;
    delete appInfo.forceReleaseNotes;
  }
});

test("the fresh-profile marker is removed once an onboarding record exists on disk", async () => {
  const { first } = twoWindows();
  docs.set(FRESH_PROFILE_DOCUMENT, JSON.stringify({ version: 1, createdAt: 1 }));
  docs.set("onboarding.json", JSON.stringify({ completedAt: null, startedAt: 5, version: 1 }));
  await launch(first, { savedSession: true });
  assert.equal(docs.has(FRESH_PROFILE_DOCUMENT), false);
  docs.set(FRESH_PROFILE_DOCUMENT, JSON.stringify({ version: 1, createdAt: 1 }));
  docs.delete("onboarding.json");
  twoWindows();
  docs.set(FRESH_PROFILE_DOCUMENT, JSON.stringify({ version: 1, createdAt: 1 }));
  await launch(first, { savedSession: true, readStored: stored({ [FRESH_PROFILE_DOCUMENT]: "{}" }) });
  assert.equal(docs.has(FRESH_PROFILE_DOCUMENT), true);
});

test("the quit command is handled here and says so when this build cannot quit", async () => {
  const { first } = twoWindows();
  useToasts.setState({ toasts: {} });
  assert.equal(runAppCommand(first, "quit", capabilities), true);
  for (let i = 0; i < 20 && !toast(first); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(toast(first)?.title, "Not available on Linux yet");
});
