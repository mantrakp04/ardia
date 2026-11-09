export default {
  session: "session-0245n3-notes.json",
  setup: `return dw("fakeActiveClicks").then(() => sleep(2500)).then(() => done());`,
  act: `return at(700, 640).then(() => sleep(500))
  .then(() => move(398, 207, 800)).then(() => sleep(300))
  .then(() => { mark("go"); return click(); }).then(() => sleep(1200))
  .then(() => move(560, 520, 700)).then(() => sleep(1800))
  .then(() => done({ title: st().tabs.r2.title, url: st().tabs.r2.url }));`,
  tail: 500,
};
