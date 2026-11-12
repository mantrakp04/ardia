export default {
  session: "session-0245n3-doc.json",
  setup: `return sleep(2500).then(() => done());`,
  act: `hide();
  return sleep(600).then(() => key("⌘T", CMD, "t", 17)).then(() => sleep(1800))
  .then(() => typeText("bing", 140)).then(() => sleep(500))
  .then(() => { mark("go"); return key("Tab", 0, "\\t", 48); }).then(() => sleep(2600))
  .then(() => done());`,
  tail: 500,
};
