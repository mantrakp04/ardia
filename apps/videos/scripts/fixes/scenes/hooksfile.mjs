import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const HOOKS = {
  hooks: [
    { name: "old-threadly", on: "tab.opening", rewrite: [{ match: "*://forum.example/*", to: "http://old.forum.example{path}{query}" }] },
  ],
};

export default {
  session: "session-r44-basic.json",
  seed(data) {
    mkdirSync(join(data, "config"), { recursive: true });
    writeFileSync(join(data, "config", "hooks.json"), JSON.stringify(HOOKS, null, 2) + "\n");
  },
  setup: `const A = ac.automation;
  const approve = () => A ? Promise.resolve(A.reloadHooks && A.reloadHooks()).then(() => sleep(800)).then(() => (A.pendingRules ? A.pendingRules() : []).forEach((r) => A.approveRule(r.key))) : null;
  return sleep(2500).then(approve).then(() => sleep(800)).then(() => done({ pending: A && A.pendingRules ? A.pendingRules().length : null, automation: !!A }));`,
  act: `return at(700, 470).then(() => sleep(700))
  .then(() => { mark("go"); return key("⌘L", CMD, "l", 37); }).then(() => sleep(900))
  .then(() => "http://forum.example/".split("").reduce((p, ch) => p.then(() => dw("type:" + ch)).then(() => sleep(110)), Promise.resolve())).then(() => sleep(500))
  .then(() => key("⏎", 0, "\\r", 36)).then(() => sleep(3200))
  .then(() => done({ url: st().tabs[st().windows[W].activeTabIds.default].url }));`,
  tail: 500,
};
