export default {
  setup: `st().updateSettings({ addressBar: "sidebar", sidebarWidth: 210 }); return sleep(2000).then(() => done());`,
  act: `return at(620, 420).then(() => sleep(300)).then(() => move(120, 64, 700)).then(() => { mark("go"); return sleep(900); }).then(() => move(120, 205, 600)).then(() => sleep(1100)).then(() => move(150, 172, 450)).then(() => sleep(1500)).then(() => move(560, 420, 700)).then(() => sleep(600)).then(() => done());`,
  tail: 300,
};
