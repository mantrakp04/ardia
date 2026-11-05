import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const seedFile = fileURLToPath(new URL("../src/seed.ts", import.meta.url));

export async function loadSeed() {
  const out = await build({ entryPoints: [seedFile], bundle: true, format: "esm", platform: "neutral", write: false, logLevel: "silent" });
  const url = `data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`;
  return import(url);
}

export async function referenceSession({ frame }) {
  const seed = await loadSeed();
  const pages = await import(`data:text/javascript;base64,${Buffer.from((await build({ entryPoints: [fileURLToPath(new URL("../src/pages.ts", import.meta.url))], bundle: true, format: "esm", platform: "neutral", write: false, logLevel: "silent" })).outputFiles[0].text).toString("base64")}`);
  const now = Date.now();
  const tabs = seed.seedTabs(pages.remoteFaviconFor, now);
  const window = seed.seedWindow(tabs, frame, now);
  return {
    version: 2,
    profiles: { [seed.PERSONAL.id]: seed.PERSONAL, [seed.WORK.id]: seed.WORK },
    profileOrder: [seed.PERSONAL.id, seed.WORK.id],
    windows: [window],
    windowOrder: [window.id],
    focusedWindowId: window.id,
    tabs,
    groups: [],
    splits: [],
    closedTabs: [],
    closedWindows: [],
    closedGroups: [],
    cleanedTabs: [],
    seed,
    pages,
  };
}
