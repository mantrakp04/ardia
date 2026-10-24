import assert from "node:assert/strict";
import { test } from "node:test";
const { useBrowser } = await import("../../store/browser.ts");
const { pinSites, preselectedSites, pinnedHosts } = await import("./sites.ts");

const S = () => useBrowser.getState();

test("onboarding never pins a site the import already pinned at a deeper page", () => {
  S().hydrate({});
  const w = S().createWindow({ url: "https://home.example/" });
  const gmail = S().newTab(w, { url: "https://mail.google.com/mail/u/0/#inbox" });
  S().pinTabs([gmail], true);
  const grouped = S().newTab(w, { url: "https://www.youtube.com/watch?v=x" });
  const g = S().createGroup([grouped]);
  S().updateGroup(g, { pinned: true });
  const before = Object.values(S().tabs).filter((t) => t.pinned).length;
  pinSites(w, ["gmail", "youtube", "github"]);
  const pinned = Object.values(S().tabs).filter((t) => t.pinned);
  assert.equal(pinned.length, before + 1, "only GitHub is new");
  assert.ok(pinned.some((t) => t.url === "https://github.com/"));
  assert.deepEqual([...pinnedHosts(w)].sort(), ["github.com", "mail.google.com", "youtube.com"]);
});

test("preselection leaves out sites already pinned", () => {
  const history = [
    { url: "https://mail.google.com/x", visits: 10 },
    { url: "https://github.com/a", visits: 8 },
  ];
  assert.deepEqual(preselectedSites(history), ["gmail", "github"]);
  assert.deepEqual(preselectedSites(history, new Set(["mail.google.com"])), ["github"]);
});
