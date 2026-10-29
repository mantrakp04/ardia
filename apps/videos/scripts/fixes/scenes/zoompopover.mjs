export default {
  setup: `return sleep(2000).then(() => done({ zoom: st().tabs.t1.zoom }));`,
  act: `return at(760, 430).then(() => sleep(700)).then(() => { mark("go"); return key("⌘+", CMD, "=", 24); }).then(() => sleep(700)).then(() => key("⌘+", CMD, "=", 24)).then(() => sleep(2700)).then(() => key("⌘−", CMD, "-", 27)).then(() => sleep(700)).then(() => key("⌘−", CMD, "-", 27)).then(() => sleep(2500)).then(() => done({ zoom: st().tabs.t1.zoom }));`,
  tail: 300,
};
