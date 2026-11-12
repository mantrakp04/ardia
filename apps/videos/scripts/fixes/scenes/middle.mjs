export default {
  setup: `st().activate("t1"); return sleep(3000).then(() => { st().activate("t3"); return sleep(800); }).then(() => done());`,
  act: `return at(620, 420).then(() => sleep(300)).then(() => move(110, 71, 800)).then(() => sleep(250)).then(() => { mark("Middle-click"); return middleClick(); }).then(() => sleep(1300)).then(() => { mark("go"); mark("Middle-click"); return middleClick(); }).then(() => sleep(2600)).then(() => done({ tabs: Object.values(st().tabs).map((t) => t.id + ":" + t.url) }));`,
};
