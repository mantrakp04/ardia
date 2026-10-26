export default {
  setup: `st().activate("t3"); return sleep(1500).then(() => done());`,
  act: `return sleep(600).then(() => { mark("go"); mark("⇧⌘N"); ac.runCommand({ command: "newIncognitoWindow" }); return null; }).then(() => sleep(3600)).then(() => done({ windows: st().windowOrder.map((id) => ({ id, incognito: st().windows[id].incognito, frame: st().windows[id].frame })) }));`,
};
