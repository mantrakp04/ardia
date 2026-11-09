export default {
  session: "session-0245n4-icons.json",
  setup: `return dw("fakeActiveClicks").then(() => sleep(2500)).then(() => done({ icons: st().settings.profileSwitcherIcons, profiles: st().profileOrder }));`,
  act: `hover = SIDE === "after";
  return at(330, 700).then(() => sleep(500))
  .then(() => move(130, 846, 800)).then(() => sleep(1100))
  .then(() => move(152, 846, 500)).then(() => sleep(700))
  .then(() => { mark("go"); return click(); }).then(() => sleep(1800))
  .then(() => done({ profile: st().windows[W].profileId }));`,
  tail: 500,
};
