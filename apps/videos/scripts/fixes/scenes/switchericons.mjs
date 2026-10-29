export default {
  setup: `return sleep(2000).then(() => done({ icons: st().settings.profileSwitcherIcons }));`,
  act: `return at(700, 520).then(() => sleep(400)).then(() => move(150, 790, 800)).then(() => sleep(600)).then(() => { mark("go"); return sleep(900); }).then(() => move(107, 838, 500)).then(() => sleep(1000)).then(() => move(130, 838, 400)).then(() => sleep(1000)).then(() => move(150, 838, 400)).then(() => sleep(1000)).then(() => move(200, 780, 500)).then(() => sleep(700)).then(() => done());`,
  tail: 300,
};
