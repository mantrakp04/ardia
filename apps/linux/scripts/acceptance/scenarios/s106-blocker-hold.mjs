import { startBrowser } from "../lib/flows.mjs";
import { sessionSeed } from "../lib/seed.mjs";
import { nonce, until } from "../lib/util.mjs";
import { blockerAvailable, blockerReady, extraArgs, pageEval } from "./f06-site-controls.mjs";

export default {
  id: "S106",
  issue: 106,
  title: "A fresh profile's first pages wait for the content blocker, so they are filtered",
  deadline: 240000,
  manual: [],
  async run(t) {
    if (!blockerAvailable(t)) {
      await t.check("the content blocker is packaged", () => {
        throw new Error("set ARDIA_ACCEPTANCE_CONTENT_BLOCKER to the uBlock Origin build from scripts/linux/fetch-ubo.sh, or run against a package built with --content-blocker");
      });
      return;
    }
    const run = nonce("hold");
    const url = t.fixtures.url.blocker("first.ardia.test", run);
    const state = await startBrowser(t, { name: "fresh", session: sessionSeed({ windows: [{ id: "main", urls: [url] }] }), extraArgs });
    await t.check("the restored first page loads with its ad image blocked", async () => {
      await until(() => t.fixtures.requests.some((r) => r.query.blocker === run), { timeout: 30000, label: "the control image request" });
      await new Promise((resolve) => setTimeout(resolve, 800));
      const ads = t.fixtures.requests.filter((r) => r.path === `/ads/banners/${run}.png`).length;
      const images = await pageEval(state.app, url, "({ ad: document.getElementById('ad').naturalWidth, control: document.getElementById('control').naturalWidth })");
      if (ads !== 0 || images.ad !== 0) throw new Error(`the first page wasn't filtered: ${JSON.stringify({ ads, images })}`);
      return { ads, images };
    });
    await t.check("the blocker reports ready and the hold left no warning", async () => {
      const blocker = await blockerReady(state.shell);
      const log = await state.app.logText();
      if (/held navigations go ahead without its blocking/.test(log)) throw new Error(log.split("\n").filter((l) => l.includes("held navigations")).join("\n"));
      return { stats: blocker.stats };
    });
  },
};
