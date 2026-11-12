export default {
  session: "session-0245n3-spaces.json",
  setup: `return sleep(3000).then(() => done({ profiles: Object.values(st().profiles).map((p) => [p.id, p.dataId, p.shareTopApps]) }));`,
  act: `hide();
  return sleep(900)
  .then(() => { mark("go"); mark("⌃2  Work"); return ac.actions.switchProfile(W, "work", true); }).then(() => sleep(1800))
  .then(() => { mark("⌃1  Personal"); return ac.actions.switchProfile(W, "default", true); }).then(() => sleep(1800))
  .then(() => done({ profile: st().windows[W].profileId }));`,
  tail: 500,
};
