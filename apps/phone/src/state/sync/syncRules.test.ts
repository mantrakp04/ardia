import assert from "node:assert/strict";
import test from "node:test";
import { NOW, status, view } from "../../../test/syncFixture.ts";
import { idleMacTabs, isPinnedOnMac, macTabIndex, pinKey, pinsStillOnTheirWay, mergeSyncedHistory, spaceRows, syncedBookmarks } from "./spaces.ts";
import {
  connectMessage,
  deviceIcon,
  deviceSeen,
  isSyncConnected,
  matchedColor,
  orderedDevices,
  phraseFooter,
  profileOf,
  receivedSender,
  receivedToast,
  sendReceivers,
  shownProfile,
  syncBanner,
  inboxNotice,
  scanJudge,
  syncedEngineName,
  syncHeroSubtitle,
  syncRowSubtitle,
} from "./syncRules.ts";

test("the Sync With Mac row and page say what each phase needs, as SyncStatusWords does", () => {
  const off = status({ phase: "off", isEnabled: false, statusText: "Off" });
  assert.deepEqual(syncRowSubtitle(off), { text: "Every tab, anywhere.", isWarning: false });
  assert.deepEqual(syncHeroSubtitle(off), { text: "Your Mac’s tabs here, and this phone’s on your Mac.", isWarning: false });
  assert.deepEqual(syncRowSubtitle(status()), { text: "Updated just now", isWarning: false });
  assert.deepEqual(syncRowSubtitle(status({ phase: "needsFolderAccess", attention: "folder" })), { text: "Choose Your Sync Folder Again", isWarning: true });
  assert.deepEqual(syncRowSubtitle(status({ phase: "locked", attention: "phrase" })), { text: "Enter Your Recovery Phrase", isWarning: true });
  assert.deepEqual(syncRowSubtitle(status({ phase: "reset", attention: "reset" })), { text: "Out of Sync", isWarning: true });
  const stalled = status({ phase: "stalled", attention: "stalled", statusText: "Not syncing · Last synced 2 hours ago" });
  assert.deepEqual(syncRowSubtitle(stalled), { text: "Not syncing · Last synced 2 hours ago", isWarning: true });
  assert.equal(syncHeroSubtitle(stalled).isWarning, true);
});

test("connected means enabled and not locked, reset or off", () => {
  assert.equal(isSyncConnected(status()), true);
  assert.equal(isSyncConnected(status({ phase: "needsFolderAccess" })), true);
  assert.equal(isSyncConnected(status({ phase: "locked" })), false);
  assert.equal(isSyncConnected(status({ phase: "reset" })), false);
  assert.equal(isSyncConnected(status({ phase: "updated", isEnabled: false })), false);
});

test("the banner shows for trouble, with Fix only where the user must act", () => {
  assert.equal(syncBanner(status()), null);
  assert.deepEqual(syncBanner(status({ phase: "needsFolderAccess", statusText: "Choose your sync folder again to keep syncing." })), {
    icon: "folder",
    text: "Choose your sync folder again to keep syncing.",
    needsAction: true,
  });
  assert.equal(syncBanner(status({ phase: "locked" }))?.needsAction, true);
  assert.equal(syncBanner(status({ phase: "reset" }))?.icon, "reset");
  assert.equal(syncBanner(status({ phase: "offline" }))?.needsAction, false);
  assert.equal(syncBanner(status({ phase: "stalled" }))?.icon, "warning");
});

test("every connect result has the Compose wording, and a cancelled pick says nothing", () => {
  assert.equal(connectMessage({ result: "connected" }), null);
  assert.equal(connectMessage({ result: "cancelled" }), null);
  assert.equal(connectMessage({ result: "invalidPhrase", problem: "“zebraa” is not a valid recovery phrase word." }), "“zebraa” is not a valid recovery phrase word.");
  assert.match(connectMessage({ result: "mismatch" })!, /doesn’t match the synced data/);
  assert.match(connectMessage({ result: "noSyncData" })!, /no synced data in this folder yet/);
  assert.match(connectMessage({ result: "folderUnavailable" })!, /can’t open this folder/);
  assert.equal(connectMessage({ result: "keyStoreFailed" }), "Couldn’t save the sync key on this phone.");
  assert.equal(connectMessage({ result: "busy" }), "Ardia is still turning off sync. Try again in a moment.");
});

test("the phrase footer shows the problem, the all-clear, or where to find the words", () => {
  const check = { wordCount: 3, counterText: "3/24 words", isTooLong: false, problem: null, isValid: false };
  assert.equal(phraseFooter(check).tone, "hint");
  assert.equal(phraseFooter({ ...check, wordCount: 24, isValid: true }).text, "All 24 words check out.");
  assert.deepEqual(phraseFooter({ ...check, problem: "This recovery phrase is not valid. Please check for typos." }).tone, "problem");
});

test("devices list the others newest first and this phone last, with when each was seen", () => {
  const devices = orderedDevices(view().devices);
  assert.deepEqual(
    devices.map((d) => d.id),
    ["air", "studio", "phone"],
  );
  assert.equal(deviceSeen(devices[0]!, NOW), "Just Now");
  assert.equal(deviceSeen(devices[1]!, NOW), "3 hours ago");
  assert.equal(deviceSeen(devices[2]!, NOW), "This Phone");
  assert.equal(deviceSeen({ ...devices[1]!, lastSeen: null }, NOW), "Not Yet Synced");
  assert.equal(deviceIcon("mac", "Shivam’s MacBook Air"), "laptop");
  assert.equal(deviceIcon("mac", "Mac Studio"), "desktop");
  assert.equal(deviceIcon("phone", "Pixel"), "phone");
});

test("a tab goes only to the profile's send targets that can take it, never to this phone", () => {
  assert.deepEqual(
    sendReceivers(view(), "work").map((d) => d.id),
    ["air"],
  );
  assert.deepEqual(
    sendReceivers(view(), "personal").map((d) => d.id),
    ["studio"],
  );
  assert.deepEqual(sendReceivers(view(), "missing"), []);
  const offline = view({ devices: view().devices.map((d) => (d.id === "air" ? { ...d, canReceiveTabs: false } : d)) });
  assert.deepEqual(sendReceivers(offline, "work"), []);
});

test("the selected profile falls back to the default, then the first", () => {
  assert.equal(profileOf(view(), "work")?.name, "Work");
  assert.equal(profileOf(view(), "gone")?.name, "Personal");
  assert.equal(profileOf(view({ profiles: [] }), "work"), null);
});

test("received tabs name their sender when there is one, else Your Mac", () => {
  assert.equal(receivedSender(["Mac Studio", "Mac Studio"]), "Mac Studio");
  assert.equal(receivedSender(["Mac Studio", "MacBook Air"]), "Your Mac");
  assert.equal(receivedSender([null, " "]), "Your Mac");
  assert.equal(receivedToast("Mac Studio", 1), "Tab from Mac Studio");
  assert.equal(receivedToast("Your Mac", 3), "3 Tabs from Your Mac");
});

test("Spaces lists tiles, pinned tabs and groups, bookmarks, then each device's tabs", () => {
  const work = view().profiles[1]!;
  const closed = spaceRows(work, new Set(), new Set());
  assert.deepEqual(
    closed.map((r) => r.kind),
    ["tiles", "tab", "group", "header", "folder", "header", "tab", "header", "tab"],
  );
  assert.equal(closed[1]!.kind === "tab" && closed[1]!.title, "github.com");
  const open = spaceRows(work, new Set(["group:g1", "folder:b1"]), new Set());
  assert.ok(open.some((r) => r.kind === "tab" && r.url === "https://plan.example/" && r.depth === 1));
  assert.ok(open.some((r) => r.kind === "tab" && r.url === "https://essay.example/" && r.depth === 1));
});

test("a device with many tabs shows eight and Show All until expanded", () => {
  const personal = view().profiles[0]!;
  const collapsed = spaceRows(personal, new Set(), new Set());
  assert.equal(collapsed.filter((r) => r.kind === "tab").length, 8);
  assert.equal(collapsed.at(-1)!.kind, "showAll");
  const expanded = spaceRows(personal, new Set(), new Set(["studio"]));
  assert.equal(expanded.filter((r) => r.kind === "tab").length, 12);
  const empty = spaceRows({ ...personal, deviceTabs: [] }, new Set(), new Set());
  assert.deepEqual(empty, [{ kind: "empty", key: "empty", name: "Personal" }]);
});

test("a page counts as pinned when the profile's bookmarks hold it, or a pin from this phone is on its way", () => {
  const work = view().profiles[1]!;
  assert.equal(isPinnedOnMac(work, "https://essay.example"), true);
  assert.equal(isPinnedOnMac(work, "http://essay.example/"), true);
  assert.equal(isPinnedOnMac(work, "https://mail.example/"), false);
  assert.equal(isPinnedOnMac(null, "https://essay.example/"), false);
  const sent = [pinKey("work", "https://new.example/a")];
  assert.equal(isPinnedOnMac(work, "https://new.example/a/", sent), true);
  assert.equal(isPinnedOnMac(view().profiles[0]!, "https://new.example/a", sent), false);
  assert.deepEqual(pinsStillOnTheirWay(sent, view().profiles), sent);
  const arrived = { ...work, bookmarks: [...work.bookmarks, { key: "b9", title: "A", url: "https://new.example/a", added: 3, root: null, children: null }] };
  assert.deepEqual(pinsStillOnTheirWay(sent, [arrived]), []);
});

test("the omnibox gets the Mac's history, bookmarks and open tabs for the selected profile", () => {
  const work = view().profiles[1]!;
  const merged = mergeSyncedHistory([{ url: "https://linear.example/", title: "", favicon: null, visits: 1, lastVisit: NOW }], work.history);
  assert.deepEqual(merged, [{ url: "https://linear.example/", title: "Linear", favicon: null, visits: 10, lastVisit: NOW }]);
  assert.deepEqual(
    syncedBookmarks(work).map((b) => b.url),
    ["https://essay.example/", "https://mail.example/", "https://docs.example/", "https://docs.example/spec"],
  );
  assert.equal(macTabIndex(work, view().devices).get("linear.example"), "Shivam’s MacBook Air");
  assert.equal(macTabIndex(work, view().devices).has("phone.example"), false);
  assert.deepEqual(idleMacTabs(work, view().devices), [{ url: "https://linear.example/", title: "Linear", deviceName: "Shivam’s MacBook Air" }]);
});

test("the Mac's search engine and colour carry over", () => {
  const engines = [
    { id: "google", name: "Google" },
    { id: "duckduckgo", name: "DuckDuckGo" },
  ];
  assert.equal(syncedEngineName({ engineId: "duckduckgo", customEngines: [] }, engines), "DuckDuckGo");
  assert.equal(syncedEngineName({ engineId: "k", customEngines: [{ id: "k", name: "Kagi Work" }] }, engines), "Kagi Work");
  assert.equal(syncedEngineName({ engineId: "custom", customEngines: [] }, engines), "Custom");
  const swatches = [
    { key: "plum", hex: "#C07A98" },
    { key: "blue", hex: "#4691C3" },
    { key: "green", hex: "#3EB489" },
  ] as const;
  assert.equal(matchedColor({ color: "#4691C3", theme: null }, swatches), "blue");
  assert.equal(matchedColor({ color: "Green", theme: null }, swatches), "green");
  assert.equal(matchedColor({ color: null, theme: { colors: ["#40B080"], darkColors: null } }, swatches), "green");
  assert.equal(matchedColor({ color: null, theme: null }, swatches), null);
});

test("a set-aside inbox shows the module's message and that Sync Now tries again", () => {
  assert.equal(inboxNotice(status()), null);
  assert.equal(inboxNotice(status({ inboxProblem: "  " })), null);
  assert.deepEqual(inboxNotice(status({ inboxProblem: "Ardia set aside some tabs and history changes from your Mac it couldn’t read." })), {
    message: "Ardia set aside some tabs and history changes from your Mac it couldn’t read.",
    footer: "Sync couldn’t read some changes your Mac sent and set that file aside. Sync Now tries again.",
  });
});

test("a scanned code is used when it is a valid phrase, rejected once otherwise, and the same code twice is ignored", () => {
  const judge = scanJudge((payload) => payload.trim().split(/\s+/).length === 24);
  const phrase = Array.from({ length: 24 }, (_, i) => `word${i}`).join(" ");
  assert.deepEqual(judge("https://ardia.dev"), { kind: "reject" });
  assert.deepEqual(judge("https://ardia.dev"), { kind: "repeat" });
  assert.deepEqual(judge(` ${phrase} `), { kind: "accept", phrase });
  assert.deepEqual(judge(` ${phrase} `), { kind: "repeat" });
});

test("the switcher marks the profile the view shows, even before the user has picked one", () => {
  const unpicked = view({ selectedProfileId: null, shownProfileId: "personal" });
  assert.equal(shownProfile(unpicked, status({ selectedProfileId: null }))?.syncId, "personal");
  assert.equal(shownProfile(view({ shownProfileId: "work" }), status({ selectedProfileId: null }))?.syncId, "work");
  assert.equal(shownProfile(view({ shownProfileId: "gone", selectedProfileId: null }), status({ selectedProfileId: null }))?.syncId, "personal");
  assert.equal(shownProfile(view({ shownProfileId: undefined }), status({ selectedProfileId: "work" }))?.syncId, "work");
  assert.equal(shownProfile(view({ shownProfileId: "work" }), status({ isEnabled: false })), null);
});
