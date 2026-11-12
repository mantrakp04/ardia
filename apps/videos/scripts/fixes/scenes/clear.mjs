export default {
  setup: `st().activate("t3"); return sleep(500).then(() => done());`,
  act: `return at(620, 420).then(() => sleep(300)).then(() => move(150, 140, 800)).then(() => sleep(250)).then(() => { mark("go"); return click(); }).then(() => sleep(2600)).then(() => done({ tabs: Object.values(st().tabs).map((t) => t.id + ":" + t.url) }));`,
};
