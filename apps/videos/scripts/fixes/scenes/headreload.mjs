export default {
  setup: `st().updateSettings({ addressBar: "sidebar", sidebarWidth: 190 }); return sleep(2000).then(() => done());`,
  act: `const widen = (from, to, ms) => { const steps = Math.round(ms / 33); const step = (i) => i > steps ? Promise.resolve() : (st().updateSettings({ sidebarWidth: Math.round(from + (to - from) * ease(i / steps)) }), sleep(33).then(() => step(i + 1))); return step(1); }; return at(560, 300).then(() => sleep(400)).then(() => { mark("go"); mark("Sidebar at 210 pt"); return widen(190, 210, 700); }).then(() => sleep(2200)).then(() => done({ width: st().settings.sidebarWidth }));`,
  tail: 400,
};
