export default {
  setup: `return sleep(2000).then(() => done({ collapsed: !!st().profiles.default.pinnedCollapsed }));`,
  act: `return at(700, 520).then(() => sleep(400)).then(() => move(34, 224, 800)).then(() => sleep(900)).then(() => { mark("go"); return click(); }).then(() => sleep(2000)).then(() => move(160, 470, 700)).then(() => sleep(1300)).then(() => done({ collapsed: !!st().profiles.default.pinnedCollapsed }));`,
  tail: 300,
};
