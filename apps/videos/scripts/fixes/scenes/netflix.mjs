export default {
  setup: `st().activate("t3"); return sleep(1500).then(() => done());`,
  act: `return sleep(600).then(() => { mark("go"); ac.actions.openUrls(["https://www.netflix.com/"]); return sleep(6000); }).then(() => done({ tab: Object.values(st().tabs).find((t) => t.url.includes("netflix")) }));`,
  tail: 400,
};
