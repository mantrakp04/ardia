import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

globalThis.__DEV__ = false;
const stubs = {
  "@ardia/ardiacore": "export const listExtensions = async () => []; export const stepPager = async () => false;",
  "@ardia/shell": "export const confirm = (options) => globalThis.groupCloseConfirm(options); export const focusWindow = () => {};",
  "../components/layout/profilePager": "export const pageToProfile = () => {};",
  "../components/profiles/CreateProfile": "export const profileNames = () => ''; export const requestCreateProfile = () => {};",
  "./nativeEvents": "export const applyHeldReports = () => globalThis.groupCloseApplyReports?.();",
  "./windowClose": "export const closeWindowDialog = () => ({});",
};
registerHooks({
  resolve(specifier, context, next) {
    if (!context.parentURL?.endsWith("/lib/actions.ts") || !(specifier in stubs)) return next(specifier, context);
    return { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true };
  },
});
const { useBrowser } = await import("../store/browser.ts");
const { groupLabel } = await import("../store/organize.ts");
const actions = await import("./actions.ts");
const S = () => useBrowser.getState();

function setup(pinned = false, windowOptions = {}) {
  S().hydrate({});
  const windowId = S().createWindow({ url: "https://example.com", ...windowOptions });
  const tabId = S().windows[windowId].tabIds[0];
  const groupId = S().createGroup([tabId], { name: "Work" });
  S().updateGroup(groupId, { pinned });
  const dialogs = [];
  globalThis.groupCloseConfirm = async (options) => {
    dialogs.push(options);
    return { confirmed: false, suppressed: false };
  };
  return { groupId, tabId, windowId, dialogs };
}

test("confirmation defaults on, and cancelling keeps the unpinned group and its tabs", async () => {
  const { groupId, tabId, windowId, dialogs } = setup();
  assert.equal(S().settings.warnBeforeClosingTabGroup, true);
  await actions.closeGroup(groupId);
  assert.ok(S().groups[groupId]);
  assert.ok(S().tabs[tabId]);
  assert.equal(S().closedGroups.length, 0);
  assert.equal(dialogs.length, 1);
  assert.equal(dialogs[0].windowId, windowId);
  assert.match(dialogs[0].title, /Work/);
  assert.equal(dialogs[0].confirmTitle, "Close Group");
  assert.equal(dialogs[0].message, "This closes the group and all its tabs.");
});

test("confirming closes the group through the store and records it for recovery", async () => {
  const { groupId, tabId } = setup();
  globalThis.groupCloseConfirm = async () => ({ confirmed: true, suppressed: false });
  await actions.closeGroup(groupId);
  assert.equal(S().groups[groupId], undefined);
  assert.equal(S().tabs[tabId], undefined);
  assert.equal(S().closedGroups.length, 1);
  S().restoreClosed(S().closedGroups[0].id);
  const restored = Object.values(S().groups).find((g) => g.name === "Work");
  assert.ok(restored);
  assert.equal(restored.pinned, false);
  assert.equal(S().tabs[restored.tabIds[0]].url, "https://example.com");
});

test("pinned groups and a disabled warning close without prompting", async () => {
  for (const pinned of [true, false]) {
    const { groupId, dialogs } = setup(pinned);
    if (!pinned) S().updateSettings({ warnBeforeClosingTabGroup: false });
    await actions.closeGroup(groupId);
    assert.equal(S().groups[groupId], undefined);
    assert.equal(dialogs.length, 0);
  }
});

test("Don't warn again changes the preference and survives a hydrate round trip", async () => {
  const { groupId } = setup();
  globalThis.groupCloseConfirm = async () => ({ confirmed: true, suppressed: true });
  await actions.closeGroup(groupId);
  assert.equal(S().settings.warnBeforeClosingTabGroup, false);
  const settings = { ...S().settings };
  S().hydrate({ settings });
  assert.equal(S().settings.warnBeforeClosingTabGroup, false);
});

test("a group removed while its dialog is pending is harmless", async () => {
  const { groupId, dialogs } = setup();
  let answer;
  globalThis.groupCloseConfirm = () => new Promise((resolve) => { answer = resolve; });
  const pending = actions.closeGroup(groupId);
  S().closeGroup(groupId);
  answer({ confirmed: true, suppressed: false });
  await pending;
  assert.equal(S().closedGroups.length, 1);
  await actions.closeGroup("missing");
  assert.equal(dialogs.length, 0);
});

test("the latest store action is used after the dialog returns", async () => {
  const { groupId } = setup();
  let answer;
  globalThis.groupCloseConfirm = () => new Promise((resolve) => { answer = resolve; });
  const pending = actions.closeGroup(groupId);
  const original = S().closeGroup;
  let called = false;
  useBrowser.setState({ closeGroup: (id) => { called = true; original(id); } });
  try {
    answer({ confirmed: true, suppressed: false });
    await pending;
    assert.equal(called, true);
    assert.equal(S().groups[groupId], undefined);
  } finally {
    useBrowser.setState({ closeGroup: original });
  }
});

for (const [change, patch] of [
  ["name", () => ({ name: "Renamed" })],
  ["added member", (group, extraTab) => ({ tabIds: [...group.tabIds, extraTab] })],
  ["removed member", (group) => ({ tabIds: group.tabIds.slice(1) })],
  ["pin state", () => ({ pinned: true })],
  ["window", (_group, _extraTab, windowId) => ({ windowId })],
  ["profile", (_group, _extraTab, _windowId, profileId) => ({ profileId })],
  ["creation time", (group) => ({ createdAt: group.createdAt + 1 })],
]) {
  test(`confirmation is cancelled when the group's ${change} changes while pending`, async () => {
    const { groupId, windowId } = setup();
    S().addTabsToGroup(groupId, [S().newTab(windowId, { url: "https://second.example/" })]);
    const extraTab = S().newTab(windowId, { url: "https://extra.example/" });
    const otherWindow = S().createWindow({ url: "https://other.example/" });
    const otherProfile = S().createProfile({ name: "Other" });
    let answer;
    globalThis.groupCloseConfirm = () => new Promise((resolve) => { answer = resolve; });
    const pending = actions.closeGroup(groupId);
    useBrowser.setState((s) => ({ groups: { ...s.groups, [groupId]: { ...s.groups[groupId], ...patch(s.groups[groupId], extraTab, otherWindow, otherProfile) } } }));
    const original = S().closeGroup;
    let called = false;
    useBrowser.setState({ closeGroup: () => { called = true; } });
    try {
      answer({ confirmed: true, suppressed: false });
      await pending;
      assert.equal(called, false);
      assert.ok(S().groups[groupId]);
    } finally {
      useBrowser.setState({ closeGroup: original });
    }
  });
}

test("confirmation survives harmless group replacement and native title updates", async () => {
  const { groupId, tabId, windowId } = setup();
  S().addTabsToGroup(groupId, [S().newTab(windowId, { url: "https://second.example/" })]);
  let answer;
  globalThis.groupCloseConfirm = () => new Promise((resolve) => { answer = resolve; });
  const pending = actions.closeGroup(groupId);
  S().updateGroup(groupId, { collapsed: true, color: "blue" });
  S().updateTab(tabId, { title: "Updated page title" });
  useBrowser.setState((s) => ({ groups: { ...s.groups, [groupId]: { ...s.groups[groupId], tabIds: [...s.groups[groupId].tabIds].reverse() } } }));
  answer({ confirmed: true, suppressed: false });
  await pending;
  assert.equal(S().groups[groupId], undefined);
  assert.equal(S().closedGroups.length, 1);
});

test("confirmation is revalidated after held native reports are applied", async () => {
  const { groupId } = setup();
  globalThis.groupCloseConfirm = async () => ({ confirmed: true, suppressed: false });
  globalThis.groupCloseApplyReports = () => S().updateGroup(groupId, { name: "Changed by a held report" });
  try {
    await actions.closeGroup(groupId);
    assert.equal(S().groups[groupId]?.name, "Changed by a held report");
    assert.equal(S().closedGroups.length, 0);
  } finally {
    globalThis.groupCloseApplyReports = undefined;
  }
});

test("confirmation is cancelled when an unnamed group's displayed label changes", async () => {
  const { groupId, tabId } = setup();
  S().updateGroup(groupId, { name: "" });
  const label = groupLabel(S(), S().groups[groupId]);
  let answer;
  globalThis.groupCloseConfirm = () => new Promise((resolve) => { answer = resolve; });
  const pending = actions.closeGroup(groupId);
  S().updateTab(tabId, { url: "https://different.example/", title: "A different site" });
  assert.notEqual(groupLabel(S(), S().groups[groupId]), label);
  answer({ confirmed: true, suppressed: false });
  await pending;
  assert.ok(S().groups[groupId]);
  assert.equal(S().closedGroups.length, 0);
});

test("private and blank groups leave no recovery entry", async () => {
  for (const options of [{ incognito: true }, { url: "" }]) {
    const { groupId, dialogs } = setup(false, options);
    globalThis.groupCloseConfirm = async (options) => {
      dialogs.push(options);
      return { confirmed: true, suppressed: false };
    };
    await actions.closeGroup(groupId);
    assert.equal(dialogs.length, 1);
    assert.equal(dialogs[0].message, "This closes the group and all its tabs.");
    assert.equal(S().closedGroups.length, 0);
  }
});
