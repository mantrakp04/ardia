import assert from "node:assert/strict";
import test from "node:test";
import { mobileSetSources, mobileSuggest } from "@ardia/core/src/mobile.ts";

const WORDS = ["otter", "lisbon", "news", "wiki", "github", "docs", "example", "tapas", "train", "weather", "maps", "mail"];

test("suggestions for each key of a long address stay far under a frame with 4,000 history rows", () => {
  const now = Date.now();
  const history = Array.from({ length: 4000 }, (_, i) => ({
    url: `https://${WORDS[i % 12]}${i}.example.com/path/${i}?q=${WORDS[(i * 7) % 12]}`,
    title: `${WORDS[(i * 5) % 12]} page ${i}`,
    favicon: null,
    visits: 1 + (i % 9),
    lastVisit: now - i * 60_000,
  }));
  const tabs = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, url: `https://${WORDS[i % 12]}.org/${i}`, title: `Tab ${i}`, favicon: null }));
  mobileSetSources({ tabs, history, bookmarks: [] });
  const address = "https://en.wikipedia.org/wiki/Otter_conservation_in_Lisbon";
  const times: number[] = [];
  for (let i = 1; i <= address.length; i++) {
    const began = performance.now();
    mobileSuggest(address.slice(0, i), { remote: [], preference: "website", limit: 8, now, currentUrl: null, currentTabId: null });
    times.push(performance.now() - began);
  }
  const sorted = [...times].sort((a, b) => a - b);
  assert.ok(sorted[Math.floor(sorted.length / 2)]! < 2, `median ${sorted[Math.floor(sorted.length / 2)]} ms`);
  assert.ok(sorted.at(-1)! < 200, `worst ${sorted.at(-1)} ms`);
});
