export default {
  session: "session-cinema.json",
  setup: `return sleep(2500).then(() => done());`,
  act: `return sleep(800).then(() => { mark("go"); mark("Compact toolbar"); st().updateSettings({ compactToolbar: true }); return sleep(2600); }).then(() => done({ compact: st().settings.compactToolbar }));`,
  tail: 300,
};
