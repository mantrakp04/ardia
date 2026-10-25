import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

const stubs = {
  "../../lib/actions": "export const closeGroup = async () => {};",
  "./menus": "export const middleClickTab = () => {};",
};
registerHooks({
  resolve(specifier, context, next) {
    if (!context.parentURL?.endsWith("/sidebar/closeControl.ts") || !(specifier in stubs)) return next(specifier, context);
    return { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true };
  },
});

const { useBrowser } = await import("../../store/browser.ts");
const { groupCloseControl, pressGroupClose, pressTabClose, tabCloseControl } = await import("./closeControl.ts");

const S = () => useBrowser.getState();
const hasPage = (id) => !!(S().tabs[id].navigation || S().tabs[id].adoptId);

function pinnedGroupInTwoWindows() {
  S().hydrate({});
  const a = S().createWindow({ url: "https://a.com/" });
  const [first] = S().windows[a].tabIds;
  const second = S().newTab(a, { url: "https://b.com/", background: true });
  S().newTab(a, { url: "https://x.com/" });
  const g = S().groupTabs([first, second], { name: "P" });
  S().updateGroup(g, { pinned: true });
  const b = S().createWindow({ url: "https://y.com/" });
  const copy = Object.values(S().groups).find((x) => x.name === "P" && x.windowId === b);
  return { g, copy: copy.id, first, second };
}

test("a pinned group's copy in another window offers − while the pages it shares are loaded, and − unloads them", () => {
  const { g, copy, first, second } = pinnedGroupInTwoWindows();
  assert.ok(hasPage(first) && hasPage(second));
  assert.equal(groupCloseControl(S(), g).icon, "minus");
  assert.equal(groupCloseControl(S(), copy)?.icon, "minus");
  pressGroupClose(copy);
  assert.ok(!hasPage(first) && !hasPage(second));
  assert.equal(groupCloseControl(S(), g), null);
  assert.equal(groupCloseControl(S(), copy), null);
});

test("a pinned tab's copy in another window shows − and unloads the page it shares", () => {
  const { copy, first } = pinnedGroupInTwoWindows();
  const mirror = S().groups[copy].tabIds.find((id) => S().tabs[id].pinKey === first || S().tabs[first].pinKey === id);
  assert.ok(mirror);
  assert.equal(tabCloseControl(S(), mirror).icon, "minus");
  pressTabClose(mirror);
  assert.ok(!hasPage(first));
});
