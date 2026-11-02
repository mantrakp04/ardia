export default {
  setup: `st().activate("t3"); return sleep(1500).then(() => done());`,
  act: `return sleep(600).then(() => { mark("go"); mark("Arc's layout"); st().updateSettings({ addressBar: "sidebar" }); return sleep(3000); }).then(() => done({ addressBar: st().settings.addressBar }));`,
};
