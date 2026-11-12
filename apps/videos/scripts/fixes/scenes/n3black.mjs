export default {
  session: "session-0245n3-black.json",
  setup: `return dw("fakeActiveClicks").then(() => sleep(3000)).then(() => done());`,
  act: `const pick = (y, first) => move(110, y, 600).then(() => sleep(250)).then(() => { if (first) mark("go"); return click(); })
    .then(() => sleep(250)).then(() => move(470, y + 60, 600)).then(() => sleep(1200));
  return at(470, 300).then(() => sleep(500))
  .then(() => pick(165, true)).then(() => pick(202)).then(() => pick(239))
  .then(() => done({ active: st().windows[W].activeTabIds.default }));`,
  tail: 500,
};
