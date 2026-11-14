import { execFileSync } from "node:child_process";

const SITES = `http://127.0.0.1:${process.env.FIXES_SITES_PORT ?? 47231}`;

export default {
  session: "session-0245n3-apps.json",
  seed: () => execFileSync("curl", ["-s", `${SITES}/__set?mail=0&chat=0&forum=0`]),
  setup: `return dw("fakeActiveClicks").then(() => sleep(2500)).then(() => done({ peekSetting: st().settings.peekLinksToOtherSites }));`,
  act: `return at(700, 640).then(() => sleep(600))
  .then(() => move(1045, 256, 800)).then(() => sleep(300))
  .then(() => { mark("go"); return click(); }).then(() => sleep(3600))
  .then(() => done({ peeks: Object.keys(st().peeks).length, tabs: Object.values(st().tabs).map((t) => t.url) }));`,
  tail: 500,
};
