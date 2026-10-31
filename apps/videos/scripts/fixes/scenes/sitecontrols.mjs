export default {
  session: "session-0243n8.json",
  setup: `return sleep(2500).then(() => done());`,
  act: `return at(760, 420).then(() => sleep(900))
  .then(() => move(1324, 30, 800)).then(() => sleep(300))
  .then(() => { mark("go"); return click(); }).then(() => sleep(1300))
  .then(() => move(1100, 94, 600)).then(() => sleep(1300))
  .then(() => move(1166, 94, 400)).then(() => sleep(1300))
  .then(() => move(1155, 237, 500)).then(() => sleep(1600))
  .then(() => done({ popover: ac.pageState.getState().popover }));`,
  tail: 400,
};
