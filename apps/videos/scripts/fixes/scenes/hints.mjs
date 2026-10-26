export default {
  setup: `st().updateSettings({ shortcuts: { closeTab: ["w", "control", "shift"] } }); st().activate("t3"); return sleep(1500).then(() => done({ shortcuts: st().settings.shortcuts }));`,
  act: `const typeAll = (text) => text.split("").reduce((p, ch) => p.then(() => dw("type:" + ch)).then(() => sleep(130)), Promise.resolve()); return sleep(600).then(() => key("⌘T", CMD, "t", 17)).then(() => sleep(1000)).then(() => { mark("go"); mark("close tab"); return typeAll("close tab"); }).then(() => sleep(3200)).then(() => done());`,
};
