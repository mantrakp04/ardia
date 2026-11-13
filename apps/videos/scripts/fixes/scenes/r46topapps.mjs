export default {
  session: "session-r46-apps.json",
  setup: `st().updateSettings({ showUnreadCounts: true }); st().activate("p1"); return sleep(2500).then(() => { st().activate("p2"); return sleep(2500); }).then(() => { st().activate("t1"); return sleep(2000); }).then(() => done({ titles: Object.values(st().tabs).map((t) => t.title) }));`,
  act: `return at(760, 520).then(() => sleep(800)).then(() => { mark("go"); return sleep(3000); })
  .then(() => { mark("status"); st().updateSettings({ showTopAppBadges: true }); return sleep(3200); })
  .then(() => done({ status: st().settings.showTopAppBadges }));`,
  tail: 400,
};
