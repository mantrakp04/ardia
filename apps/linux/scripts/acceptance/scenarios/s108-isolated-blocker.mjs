import { startBrowser } from "../lib/flows.mjs";
import { js, nonce } from "../lib/util.mjs";
import { openProfileWindow } from "./f02-profiles.mjs";
import { blockerAvailable, blockerReady, call, expectBlocked, extraArgs } from "./f06-site-controls.mjs";

export default {
  id: "S108",
  issue: 108,
  title: "Isolated-profile windows load the content blocker and follow the default profile's settings",
  deadline: 360000,
  manual: [
    { name: "The site panel acts the same in an isolated window", steps: ["Open an isolated profile's window and the Site Controls panel on an ad-carrying page.", "Turning the blocker off for the site there lists it in Settings › Privacy and the default profile's windows load that site's ads too."], reason: "needs the visible panel" },
  ],
  async run(t) {
    if (!blockerAvailable(t)) {
      await t.check("the content blocker is packaged", () => {
        throw new Error("set ARDIA_ACCEPTANCE_CONTENT_BLOCKER to the uBlock Origin build from scripts/linux/fetch-ubo.sh");
      });
      return;
    }
    const run = nonce("s108");
    const state = await startBrowser(t, { name: "isolated-blocker", extraArgs });
    await blockerReady(state.shell);
    let isolated;
    await t.check("an isolated profile's window blocks the F06 ad image", async () => {
      const profileId = await state.shell.state(`return s.createProfile({ name: ${js(`Blocker ${run}`)} });`);
      const opened = await openProfileWindow(state.app, state.shell, `return s.createWindow({ profileId: ${js(profileId)} });`, "isolated window");
      const blank = t.fixtures.url.page(1, nonce("iso"));
      const tabId = await opened.shell.newTab(blank);
      await opened.shell.waitTabUrl(tabId, (u) => u === blank);
      isolated = { profileId, shell: opened.shell, app: state.app, tabId };
      return expectBlocked(isolated, tabId, "news.ardia.test", t, true, "the isolated window's ad image to be blocked");
    }, { critical: true });

    await t.check("a site exception set from the default profile reaches the isolated profile", async () => {
      await call(state.shell, "contentBlocker.setAllowed", { host: "news.ardia.test", allowed: true });
      const loaded = await expectBlocked(isolated, isolated.tabId, "news.ardia.test", t, false, "the excepted ad image in the isolated window");
      const elsewhere = await expectBlocked(isolated, isolated.tabId, "other.ardia.test", t, true, "other sites to stay blocked in the isolated window");
      return { loaded, elsewhere };
    });

    await t.check("blocker calls from the isolated window act on the default profile's settings", async () => {
      await call(isolated.shell, "contentBlocker.setAllowed", { host: "news.ardia.test", allowed: false }, isolated.profileId);
      const listed = (await call(state.shell, "contentBlocker.state")).allowedHosts;
      if (listed.includes("news.ardia.test")) throw new Error(`still excepted: ${JSON.stringify(listed)}`);
      return expectBlocked(isolated, isolated.tabId, "news.ardia.test", t, true, "the ad image to be blocked again in the isolated window");
    });
  },
};
