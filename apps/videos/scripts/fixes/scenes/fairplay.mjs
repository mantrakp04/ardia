export default {
  setup: `st().activate("t3"); return sleep(3000).then(() => done());`,
  act: `return at(900, 520).then(() => sleep(400)).then(() => { mark("go"); ac.actions.openUrls(["http://localhost:47231/fairplay/"]); return sleep(2200); }).then(() => move(577, 201, 800)).then(() => sleep(400)).then(() => click()).then(() => sleep(1000)).then(() => move(760, 470, 700)).then(() => sleep(2600)).then(() => done({ tab: Object.values(st().tabs).find((t) => t.url.includes("fairplay")) }));`,
};
