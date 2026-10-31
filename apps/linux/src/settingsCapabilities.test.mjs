import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as sharedIndex from "../../browser/src/components/settings/settingsIndex.ts";
import * as sharedForm from "../../browser/src/components/settings/Form.tsx";
import * as sharedEngines from "../../browser/src/state/engines/engines.ts";
import * as index from "./settingsIndex.ts";
import * as form from "./settingsForm.tsx";
import * as engines from "./hostEngines.ts";

const hidden = ["general.defaultBrowser", "general.openAtLogin", "appearance.pageScrollBars", "advanced.cliControl", "advanced.cliInstall", "tabs.videoUpscaling"];

test("Settings navigation and search leave out the unavailable Engines pane and platform rows", () => {
  assert.ok(sharedIndex.PANES.some((pane) => pane.id === "engines"));
  assert.deepEqual(index.PANES.map((pane) => pane.id), sharedIndex.PANES.map((pane) => pane.id).filter((id) => id !== "engines"));
  const searchable = new Set(index.SETTINGS_INDEX.map((item) => item.entry.id));
  for (const id of hidden) {
    assert.ok(sharedIndex.SETTINGS_INDEX.some((item) => item.entry.id === id), id);
    assert.equal(searchable.has(id), false, id);
    assert.equal(index.settingUnavailable(id), true, id);
    assert.equal(index.setting(id).id, id);
  }
  assert.equal([...searchable].some((id) => id.startsWith("engines.")), false);
  assert.ok(searchable.has("general.warnBeforeQuitting"));
  assert.equal(index.settingUnavailable("general.warnBeforeQuitting"), false);
  assert.equal(index.settingUnavailable(undefined), false);
});

test("Settings form primitives drop unavailable rows and keep available ones unchanged", () => {
  for (const anchor of hidden) assert.equal(form.Row({ anchor }), null, anchor);
  assert.equal(form.Anchor({ id: "general.defaultBrowser", children: null }), null);
  const header = (props, pane = null) => renderToStaticMarkup(createElement(sharedForm.SettingsPaneContext.Provider, { value: pane }, createElement(form.SectionHeader, props)));
  assert.equal(header({ anchor: "engines.websiteRules" }), "");
  assert.equal(header({ title: "Command line" }, "advanced"), "");
  assert.equal(header({ title: "Default engine" }, "engines"), "");
  assert.equal(index.sectionUnavailable("advanced", "Command line"), true);
  assert.equal(index.sectionUnavailable("advanced", "Browsing"), false);
  assert.equal(index.sectionUnavailable("general", "No such section"), false);
  assert.equal(form.Group({ of: "engines.websiteRules", children: null }), null);
  const kept = form.Row({ anchor: "general.warnBeforeQuitting" });
  assert.equal(kept.type, sharedForm.Row);
  assert.equal(form.Anchor({ id: "general.warnBeforeQuitting", children: null }).type, sharedForm.Anchor);
  const group = form.Group({ children: [
    createElement(form.Row, { key: "a", anchor: "general.openAtLogin" }),
    createElement(form.Row, { key: "b", anchor: "general.warnBeforeQuitting" }),
  ] });
  assert.equal(group.type, sharedForm.Group);
  assert.deepEqual(group.props.children.map((child) => child.props.anchor), ["general.warnBeforeQuitting"]);
  assert.equal(form.Group({ children: [createElement(form.Row, { key: "a", anchor: "engines.defaultEngine" })] }), null);
  assert.equal(form.SettingsPaneContext, sharedForm.SettingsPaneContext);
});

test("every engine decision is Chromium on Linux even with stored WebKit settings, rules and streaming routes", () => {
  const s = {
    settings: { pageEngine: "webkit", protectedVideoInWebKit: true, websiteEngines: { "https://example.com": "webkit" } },
    tabs: {
      t1: { id: "t1", url: "https://www.netflix.com/title/1", engine: "webkit", page: { kind: "idle" } },
      t2: { id: "t2", url: "https://example.com/page", page: { kind: "idle" } },
      t3: { id: "t3", url: "https://other.example/", page: { kind: "adopted", adopt: "webkit:7", nav: null } },
    },
  };
  assert.equal(sharedEngines.tabEngine(s, "t1"), "webkit");
  assert.equal(sharedEngines.builtInEngine(s, "https://www.netflix.com/"), "webkit");
  assert.equal(engines.defaultEngine(s), "chromium");
  for (const id of ["t1", "t2", "t3", "missing"]) {
    assert.equal(engines.tabEngine(s, id), "chromium", id);
    assert.equal(engines.engineMark(s, id), null, id);
  }
  for (const url of ["https://www.netflix.com/", "https://example.com/page", "https://plain.example/"]) {
    assert.equal(engines.ruleFor(s, url), undefined);
    assert.equal(engines.builtInEngine(s, url), undefined);
    assert.equal(engines.chosenEngine(s, url), "chromium");
    assert.equal(engines.recommendedEngineFor(s, url), "chromium");
    assert.equal(engines.engineForUrl(s, url), "chromium");
    assert.equal(engines.typedNavigationEngine(s, s.tabs.t2, url), "chromium");
    assert.equal(engines.canSwitchEngine(url), false);
  }
  assert.equal(engines.chosenEngine(s, "chrome://settings"), undefined);
  assert.equal(engines.siteOf, sharedEngines.siteOf);
  assert.equal(engines.ENGINE_NAMES, sharedEngines.ENGINE_NAMES);
});
