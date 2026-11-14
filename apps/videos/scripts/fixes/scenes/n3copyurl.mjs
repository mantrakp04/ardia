const BUTTON = (process.env.N3_BUTTON ?? "1290,30").split(",").map(Number);

export default {
  session: "session-0245n3-doc.json",
  setup: `st().updateSettings({ showBookmarks: false }); return dw("fakeActiveClicks").then(() => sleep(2500)).then(() => done({ shown: st().settings.showBookmarks }));`,
  act: `return at(700, 500).then(() => sleep(500))
  .then(() => move(${BUTTON[0] - 260}, 31, 800)).then(() => sleep(900))
  .then(() => move(${BUTTON[0]}, ${BUTTON[1]}, 600)).then(() => sleep(500))
  .then(() => { mark("go"); return click(); }).then(() => sleep(2600))
  .then(() => done());`,
  tail: 500,
};
