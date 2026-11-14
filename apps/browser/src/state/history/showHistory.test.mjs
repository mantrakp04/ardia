import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../browser/store.ts");
const { runCommand } = await import("../commands/commands.ts");
const { settlingCommandFocus, cancelAbandonedFocusMoves } = await import("../focus/focusHandoff.ts");
const { claimFocusTag, historySearchFocus } = await import("../focus/focusClaims.ts");
const { useHistorySearchFocusRequest } = await import("./showHistory.ts");
const { shellNativeModules } = await import("../../test-native/shell.ts");
await import("../../test-native/index.ts");

const S = () => useBrowser.getState();
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const requested = () => useHistorySearchFocusRequest.getState().tabId;

function recordFocusSenders() {
  const sent = { claims: [], cancels: [] };
  const shell = shellNativeModules.ArdiaFocus;
  shell.claimFocus = (generation, tag) => Promise.resolve(void sent.claims.push([generation, tag]));
  shell.cancelFocusMove = (generation, restoring) => Promise.resolve(void sent.cancels.push([generation, restoring]));
  return sent;
}

function windowOnPage() {
  S().hydrate({});
  const w = S().createWindow({ url: "https://a.com/" });
  S().setFocusedWindow(w);
  useHistorySearchFocusRequest.setState({ tabId: null });
  return w;
}

const activeTab = (w) => S().windows[w].activeTabIds[S().windows[w].profileId];
const pressCmdY = (w, generation) => settlingCommandFocus({ command: "showHistory", arg: null, windowId: w, focusGeneration: generation }, runCommand);

test("⌘Y opens History and asks its search field for focus, which then claims the held keys", async () => {
  const sent = recordFocusSenders();
  const w = windowOnPage();
  pressCmdY(w, 101);
  const history = activeTab(w);
  assert.equal(S().tabs[history].url, "ardia://history");
  assert.equal(requested(), history);
  assert.deepEqual(sent.cancels, []);
  claimFocusTag(w, historySearchFocus(history), () => 7);
  await settle();
  assert.deepEqual(sent.claims, [[101, 7]]);
});

test("⌘Y on History that's already showing asks for the search field again", async () => {
  const sent = recordFocusSenders();
  const w = windowOnPage();
  runCommand({ command: "showHistory", arg: null, windowId: w });
  const history = activeTab(w);
  useHistorySearchFocusRequest.setState({ tabId: null });
  pressCmdY(w, 102);
  assert.equal(activeTab(w), history);
  assert.equal(requested(), history);
  assert.deepEqual(sent.cancels, []);
  claimFocusTag(w, historySearchFocus(history), () => 8);
  await settle();
  assert.deepEqual(sent.claims, [[102, 8]]);
});

test("leaving History before its field claims focus cancels the move", async () => {
  const sent = recordFocusSenders();
  const w = windowOnPage();
  const page = activeTab(w);
  const stop = cancelAbandonedFocusMoves();
  try {
    pressCmdY(w, 103);
    S().activate(page);
    assert.deepEqual(sent.cancels.filter(([generation]) => generation === 103), [[103, true]]);
  } finally {
    stop();
  }
});
