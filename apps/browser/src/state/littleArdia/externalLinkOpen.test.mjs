import assert from "node:assert/strict";
import { test } from "node:test";
await import("../../test-native/index.ts");
const { useBrowser } = await import("../browser/store.ts");
const { openExternalUrls } = await import("./actions.ts");
const { externalLinkOpen } = await import("./externalLinkOpen.ts");

const S = () => useBrowser.getState();
const PERSONAL = { id: "default", name: "Personal", color: "plum", icon: null, createdAt: 0 };
const WORK = { id: "work", name: "Work", color: "blue", icon: null, createdAt: 1 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("off, every link from another app opens as a tab", () => {
  for (const urls of [["https://a.example/"], ["file:///tmp/a.html"], ["https://a.example/", "https://b.example/"], ["mailto:x@example.com"]])
    assert.equal(externalLinkOpen(false, urls), "tab", urls.join(" "));
});

test("on, one web page opens in Little Ardia and anything else as tabs", () => {
  assert.equal(externalLinkOpen(true, ["https://a.example/"]), "littleArdia");
  assert.equal(externalLinkOpen(true, ["file:///tmp/a.html"]), "littleArdia");
  assert.equal(externalLinkOpen(true, ["https://a.example/", "https://b.example/"]), "tab");
  assert.equal(externalLinkOpen(true, ["mailto:x@example.com"]), "tab");
  assert.equal(externalLinkOpen(true, []), "tab");
});

test("an opening rule's choice wins over the setting both ways", () => {
  assert.equal(externalLinkOpen(false, ["https://a.example/"], "littleArdia"), "littleArdia");
  assert.equal(externalLinkOpen(true, ["https://a.example/"], "tab"), "tab");
  assert.equal(externalLinkOpen(false, ["https://a.example/"], "window"), "window");
});

function fresh(windows) {
  S().hydrate({ profiles: { default: PERSONAL, work: WORK }, profileOrder: ["default", "work"], windows: {}, tabs: {} });
  return windows();
}

const smalls = () => Object.values(S().windows).filter((w) => w.kind === "small");
const tabWith = (url) => Object.values(S().tabs).find((t) => t.url === url);

async function open(url) {
  openExternalUrls([url], undefined, { bundleId: "com.tinyspeck.slackmacgap", appName: "Slack" });
  await wait(20);
  return tabWith(url);
}

const STATES = {
  "a main window": () => S().createWindow({ url: "https://home.example/" }),
  "no window": () => null,
  "Little Ardia in front": () => {
    const main = S().createWindow({ url: "https://home.example/" });
    S().createWindow({ kind: "small", url: "https://little.example/" });
    return main;
  },
  "the last window used in another profile": () => {
    S().createWindow({ url: "https://home.example/" });
    const work = S().createWindow({ url: "https://work.example/", profileId: "work" });
    useBrowser.setState((s) => ({ ui: { ...s.ui, lastProfileId: "work" } }));
    return work;
  },
};

for (const [name, setUp] of Object.entries(STATES)) {
  test(`off with ${name}, a link from another app opens as a tab of a main window`, async () => {
    const target = fresh(setUp);
    S().updateSettings({ openLinksInLittleArdia: false });
    const before = smalls().length;
    const tab = await open(`https://link.example/${encodeURIComponent(name)}`);
    assert.ok(tab, "the link opened");
    assert.equal(S().windows[tab.windowId].kind, "main");
    if (target) assert.equal(tab.windowId, target);
    assert.equal(smalls().length, before);
  });
}

test("the setting applies to the next link at once, both ways", async () => {
  fresh(() => S().createWindow({ url: "https://home.example/" }));
  S().updateSettings({ openLinksInLittleArdia: true });
  await open("https://one.example/");
  assert.equal(smalls().length, 1);
  S().updateSettings({ openLinksInLittleArdia: false });
  assert.equal(S().windows[(await open("https://two.example/")).windowId].kind, "main");
  assert.equal(smalls().length, 1);
  S().updateSettings({ openLinksInLittleArdia: true });
  await open("https://three.example/");
  assert.equal(smalls().length, 2);
});
