import assert from "node:assert/strict";
import test from "node:test";
import { copyTable } from "../../lib/platformCopy.ts";
import {
  pageSwipe,
  clearChoice,
  clearFooter,
  clearIsEmpty,
  clearMessage,
  clearSince,
  clearTitle,
  exportableUrls,
  listFacts,
  listsStatus,
  listStatus,
  myFiltersCount,
  myFiltersSummary,
  defaultBrowserCopy,
  nextStep,
  offersDefaultBrowser,
  previousStep,
  resetMessage,
  updatedText,
  validListUrl,
  websiteDataKinds,
} from "./settingsRules.ts";

const now = new Date(2026, 10, 14, 15, 30).getTime();

test("clear ranges start where Compose's ClearRange does", () => {
  assert.equal(clearSince("lastHour", now), now - 3_600_000);
  assert.equal(clearSince("today", now), new Date(2026, 10, 14).getTime());
  assert.equal(clearSince("todayAndYesterday", now), new Date(2026, 10, 13).getTime());
  assert.equal(clearSince("allTime", now), null);
});

test("Archived Tabs only clear with All Time, and the words read as on Android", () => {
  assert.equal(clearChoice(true, true, false, true, "today").archive, false);
  const all = clearChoice(true, true, true, true, "allTime");
  assert.equal(clearTitle(all, "allTime"), "Clear History, Cache, Cookies, and Archived Tabs from all time?");
  assert.equal(clearTitle(clearChoice(true, true, false, false, "today"), "today"), "Clear History and Cache from today?");
  assert.equal(clearMessage(all), "You’ll be signed out of websites. Open tabs stay open.");
  assert.equal(clearFooter(clearChoice(false, false, false, false, "today")), "Choose what to clear.");
  assert.equal(clearFooter(clearChoice(true, false, false, false, "today")), "History clears from this phone. Your Mac’s history stays on your Mac. You’ll stay signed in to websites.");
  assert.equal(clearIsEmpty(clearChoice(false, false, false, true, "today")), true);
  assert.deepEqual(websiteDataKinds(all), ["cache", "cookiesAndSiteData"]);
});

test("filter list rows and status read as FilterListWords", () => {
  assert.deepEqual(listFacts({ state: "ready", isEnabled: false, updatedAt: null, ruleCount: 0 }, now), { text: "Downloads when you turn it on", isWarning: false });
  assert.deepEqual(listFacts({ state: "ready", isEnabled: true, updatedAt: now - 2 * 3_600_000, ruleCount: 12345 }, now), {
    text: "12,345 rules · Updated 2 hours ago",
    isWarning: false,
  });
  assert.equal(listFacts({ state: "failed", isEnabled: true, updatedAt: null, ruleCount: 1 }, now).isWarning, true);
  assert.equal(listFacts({ state: "offline", isEnabled: true, updatedAt: null, ruleCount: 1 }, now).text, "1 rule · Waiting for a connection");
  assert.equal(listStatus({ state: "ready", isEnabled: false, updatedAt: null, ruleCount: 0 }), "Off");
  assert.equal(listsStatus(false, true, now - 30_000, now), "Offline · Updated just now");
  assert.equal(updatedText(null, now), "Not updated yet");
  assert.equal(resetMessage(2), "uBlock Origin’s default lists turn back on, the rest turn off, and 2 lists you added will be removed.");
});

test("My Filters and the add-a-list field", () => {
  assert.equal(myFiltersCount(0), "None");
  assert.equal(myFiltersSummary(3, 1, false), "3 rules · 1 skipped");
  assert.equal(myFiltersSummary(0, 0, false), "No rules yet");
  assert.equal(myFiltersSummary(3, 0, true), "Changes aren’t applied yet");
  assert.equal(validListUrl(" https://example.com/filters.txt "), "https://example.com/filters.txt");
  assert.equal(validListUrl("example.com/filters.txt"), null);
  assert.equal(validListUrl("https://localhost"), null);
});

test("onboarding runs Welcome, Blocking, All Set without the sync and default browser steps", () => {
  assert.equal(nextStep("welcome"), "blocking");
  assert.equal(nextStep("blocking"), "sync");
  assert.equal(nextStep("sync"), "allSet");
  assert.equal(previousStep("allSet"), "sync");
  assert.equal(nextStep("allSet"), null);
  assert.equal(previousStep("welcome"), null);
});

test("Export Open Tabs shares the web addresses of regular tabs only", () => {
  assert.deepEqual(
    exportableUrls([
      { url: "https://a.example/", isPrivate: false },
      { url: "about:blank", isPrivate: false },
      { url: "https://secret.example/", isPrivate: true },
    ]),
    ["https://a.example/"],
  );
});

test("onboarding asks about the default browser only where the phone can be asked or already has Ardia", () => {
  assert.equal(nextStep("blocking", true), "defaultBrowser");
  assert.equal(nextStep("defaultBrowser", true), "sync");
  assert.equal(nextStep("blocking", false), "sync");
  assert.equal(previousStep("sync", true), "defaultBrowser");
  assert.equal(previousStep("sync", false), "blocking");
  assert.equal(nextStep("defaultBrowser", false), "sync");
  assert.equal(offersDefaultBrowser({ isDefault: false, canAsk: true }), true);
  assert.equal(offersDefaultBrowser({ isDefault: true, canAsk: false }), true);
  assert.equal(offersDefaultBrowser({ isDefault: false, canAsk: false }, false), false);
  assert.equal(offersDefaultBrowser(null), false);
});

test("the default browser page has the two steps until Ardia is the default, then says so", () => {
  assert.deepEqual(defaultBrowserCopy({ isDefault: false, canAsk: true }), {
    title: "Make Ardia your default browser",
    subtitle: "Open links from other apps in Ardia.",
    steps: ["Tap “Set as Default Browser”", "Select Ardia"],
    action: "Set as Default Browser",
    does: "askForRole",
  });
  assert.deepEqual(defaultBrowserCopy({ isDefault: true, canAsk: false }), {
    title: "Ardia is your default browser",
    subtitle: "Links from other apps open in Ardia.",
    steps: [],
    action: null,
    does: null,
  });
});

test("without the browser role on offer, Android sends you to Default Apps to choose the browser app", () => {
  const copy = defaultBrowserCopy({ isDefault: false, canAsk: false });
  assert.deepEqual(copy.steps, ["Tap “Open Default Apps”", "Choose Browser app"]);
  assert.equal(copy.action, "Open Default Apps");
  assert.equal(copy.does, "openDefaultApps");
  assert.equal(offersDefaultBrowser({ isDefault: false, canAsk: false }, true), true);
});

test("on iPhone the page has the three Settings steps and opens Ardia in Settings", () => {
  const ios = copyTable("ios");
  const copy = defaultBrowserCopy({ isDefault: true, canAsk: false }, ios.defaultBrowserInstructions);
  assert.equal(copy.title, "How to change your default browser");
  assert.deepEqual(copy.steps, ["Open Ardia in Settings", "Tap on “Default Browser App”", "Select Ardia"]);
  assert.equal(copy.does, "openAppSettings");
  assert.equal(offersDefaultBrowser({ isDefault: false, canAsk: false }, ios.offersDefaultBrowserAlways), false);
  assert.equal(offersDefaultBrowser({ isDefault: false, canAsk: true }, ios.offersDefaultBrowserAlways), true);
});

test("the Swipe to Navigate setting reaches the page view in the module's words", () => {
  assert.equal(pageSwipe("anywhere"), "anywhere");
  assert.equal(pageSwipe("screenEdges"), "edges");
  assert.equal(pageSwipe("disabled"), "off");
});
