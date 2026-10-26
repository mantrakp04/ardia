import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;

const { resolveFavicon, useFavicons } = await import("../favicons/favicons.ts");
const { launchFavicons, seedFavicons } = await import("../favicons/launchFavicons.ts");
const { useBrowser } = await import("../browser/store.ts");
const { engineProfile } = await import("../browser/model.ts");

const LIMIT = 1024 * 1024;
const image = (i) => `data:image/png;base64,${String(i).padStart(4, "0")}${"A".repeat(16 * 1024 - 40)}`;

test("the launch favicons stay under 1 MiB serialized, each image stored once", () => {
  useBrowser.getState().hydrate({});
  const key = engineProfile("default");
  const pages = {};
  const srcs = {};
  const themes = {};
  const tabs = [];
  for (let i = 0; i < 66; i++) {
    const page = `https://site${i}.test/`;
    const src = `https://site${i}.test/favicon.ico`;
    pages[page] = image(i);
    srcs[src] = image(i);
    themes[image(i)] = { kind: "template", fill: "#000000", stroke: "#ffffff" };
    tabs.push({ url: page, favicon: src, profileId: "default" });
  }
  useFavicons.setState({ profiles: { [key]: { pages, srcs, appearances: {} } }, themes });

  const look = launchFavicons(tabs);
  const json = JSON.stringify(look);
  assert.ok(json.length <= LIMIT, `${json.length} characters`);
  assert.equal(new Set(look.images).size, look.images.length);
  assert.ok(look.images.length >= 50, `${look.images.length} icons kept`);

  useFavicons.setState({ profiles: {}, themes: {} });
  seedFavicons(JSON.parse(json));
  assert.equal(resolveFavicon("https://site0.test/", "https://site0.test/favicon.ico", "default")?.uri, image(0));
  assert.equal(useFavicons.getState().themes[image(0)]?.kind, "template");
  const dropped = tabs.find((t) => !look.images.includes(image(Number(t.url.match(/site(\d+)/)[1]))));
  if (dropped) assert.equal(resolveFavicon(dropped.url, null, "default"), null);
});
