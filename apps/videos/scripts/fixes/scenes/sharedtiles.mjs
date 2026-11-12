export default {
  session: "session-r44-profiles.json",
  setup: `return sleep(2500).then(() => done({ tiles: Object.values(st().tabs).filter((t) => t.pinned).map((t) => [t.id, t.profileId, t.url]) }));`,
  act: `const tiles = (p) => Object.values(st().tabs).filter((t) => t.pinned && t.profileId === p).length;
  const toWork = () => { mark("⌃2  Work"); return ac.actions.switchProfile(W, "work", true); };
  const toPersonal = () => { mark("⌃1  Personal"); return ac.actions.switchProfile(W, "default", true); };
  const counts = [];
  return at(700, 470).then(() => sleep(900))
  .then(() => { mark("go"); counts.push(["personal", tiles("default")]); return toWork(); }).then(() => sleep(2200))
  .then(() => { counts.push(["work", tiles("work")]); mark("Pin"); return st().pinTabs([st().windows[W].activeTabIds.work], true); }).then(() => sleep(1800))
  .then(() => toPersonal()).then(() => sleep(2400))
  .then(() => { counts.push(["personal", tiles("default")]); return done({ counts }); });`,
  tail: 500,
};
