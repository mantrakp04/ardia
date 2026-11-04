export default {
  session: "session-r44-glass.json",
  setup: `return sleep(2000).then(() => done({ style: st().settings.interfaceStyle }));`,
  act: `return at(700, 600).then(() => sleep(500))
  .then(() => { mark("go"); mark("⌘T"); return dw("keys:" + CMD + ":t:17"); }).then(() => sleep(1100))
  .then(() => "maps".split("").reduce((p, ch) => p.then(() => dw("type:" + ch)).then(() => sleep(120)), Promise.resolve())).then(() => sleep(700))
  .then(() => move(1065, 454, 900)).then(() => sleep(1600))
  .then(() => move(990, 454, 500)).then(() => sleep(1400))
  .then(() => done());`,
  tail: 400,
};
