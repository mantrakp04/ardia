export default {
  session: "session-0246n6-unread.json",
  setup: `st().updateSettings({ showUnreadCounts: true }); st().activate("u2"); return sleep(2500).then(() => { st().activate("u1"); return sleep(2500); }).then(() => done({ titles: Object.values(st().tabs).map((t) => t.title) }));`,
  act: `const PAD0 = Date.now();
return sleep(800).then(() => { mark("go"); return sleep(3600); }).then(() => sleep(Math.max(0, PAD0 + 13600 - Date.now()))).then(() => done({ titles: Object.values(st().tabs).map((t) => t.title) }));`,
  tail: 400,
};
