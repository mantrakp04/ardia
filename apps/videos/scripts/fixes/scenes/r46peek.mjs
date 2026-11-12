export default {
  session: "session-r46-news.json",
  setup: `return dw("fakeActiveClicks").then(() => sleep(2500)).then(() => done({ peekSetting: st().settings.peekLinksToOtherSites }));`,
  act: `return at(760, 600).then(() => sleep(600))
  .then(() => move(520, 322, 800)).then(() => sleep(350))
  .then(() => { mark("go"); return click(); }).then(() => sleep(3800))
  .then(() => done({ peeks: Object.keys(st().peeks || {}).length, url: st().tabs.n1.url }));`,
  tail: 500,
};
