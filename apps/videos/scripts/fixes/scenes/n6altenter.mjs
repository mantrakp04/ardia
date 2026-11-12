export default {
  session: "session-0246n6-tabs.json",
  setup: `return sleep(2500).then(() => done());`,
  act: `const PAD0 = Date.now();
const typeAll = (text) => text.split("").reduce((p, ch) => p.then(() => dw("type:" + ch)).then(() => sleep(110)), Promise.resolve());
return sleep(600).then(() => key("⌘L", CMD, "l", 37)).then(() => sleep(900))
  .then(() => typeAll("http://chat.example")).then(() => sleep(700))
  .then(() => { mark("go"); mark("⌥↩"); return dw("keys:" + OPT + ":\\r:36"); }).then(() => sleep(3000))
  .then(() => sleep(Math.max(0, PAD0 + 13600 - Date.now())))
  .then(() => done({ splits: Object.keys(st().splits || {}).length, tabs: st().windows[W].tabIds.length }));`,
  tail: 400,
};
