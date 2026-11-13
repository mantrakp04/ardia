export default {
  session: "session-r46-news.json",
  setup: `return dw("fakeActiveClicks").then(() => sleep(2500)).then(() => done());`,
  act: `return at(760, 640).then(() => sleep(600))
  .then(() => move(520, 446, 800)).then(() => sleep(350))
  .then(() => withKeys(CMD, "⌘-click", () => { mark("go"); return click(); })).then(() => sleep(1800))
  .then(() => move(1000, 72, 900)).then(() => sleep(1600))
  .then(() => done({ tabs: st().windows[W].tabIds.length }));`,
  tail: 500,
};
