export default {
  session: "session-0245n3-doc.json",
  setup: `return sleep(2500).then(() => done({ frame: st().settings.pageFrame }));`,
  act: `hide();
  const steps = [8, 7, 6, 5, 4, 3, 2, 1, 0];
  return sleep(900).then(() => { mark("go"); events.push({ t: Date.now(), mark: "Page Frame 9 → 0" }); })
  .then(() => steps.reduce((p, v) => p.then(() => { st().updateSettings({ pageFrame: v }); return sleep(170); }), Promise.resolve()))
  .then(() => sleep(2600)).then(() => done({ frame: st().settings.pageFrame }));`,
  tail: 500,
};
