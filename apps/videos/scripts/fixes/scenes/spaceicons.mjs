export default {
  setup: `return sleep(1500).then(() => done({ icons: Object.values(st().profiles).map((p) => p.icon) }));`,
  act: `return at(600, 600).then(() => sleep(300)).then(() => move(150, 760, 700)).then(() => sleep(400)).then(() => { mark("go"); mark("Show icons"); st().updateSettings({ profileSwitcherIcons: true }); return sleep(1600); }).then(() => move(96, 838, 600)).then(() => sleep(1600)).then(() => done({ shown: st().settings.profileSwitcherIcons }));`,
  tail: 400,
};
