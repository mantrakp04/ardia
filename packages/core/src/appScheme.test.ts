import assert from "node:assert/strict";
import { test } from "node:test";
import { appScheme, appSchemeFor, appUrlOrigin, appUrlRoute, setAppScheme, toAppUrl, toEngineUrl } from "./appUrls.ts";
import { breadcrumb, fixupUrl, resolveInput, urlForDisplay } from "./omnibox.ts";
import { displayUrl } from "./suggest.ts";

test("upstream keeps ardia:// until a product name is set", () => {
  assert.equal(appScheme(), "ardia");
  assert.equal(urlForDisplay("chrome://version/"), "ardia://version");
  assert.equal(fixupUrl("ardia://version"), "ardia://version");
});

test("the scheme is the product name, lowercased, and never a scheme the engine owns", () => {
  assert.equal(appSchemeFor("Name"), "name");
  assert.equal(appSchemeFor("My Browser"), "mybrowser");
  assert.equal(appSchemeFor("Chrome"), "ardia");
  assert.equal(appSchemeFor("HTTP"), "ardia");
  assert.equal(appSchemeFor("42"), "ardia");
  assert.equal(appSchemeFor(""), "ardia");
  assert.equal(appSchemeFor(null), "ardia");
});

test("a fork displays chrome:// and ardia:// pages under its own scheme", () => {
  assert.equal(setAppScheme("Name"), "name");
  assert.equal(urlForDisplay("chrome://version/"), "name://version");
  assert.equal(urlForDisplay("ardia://version/"), "name://version");
  assert.equal(urlForDisplay("name://history/?q=a"), "name://history?q=a");
  assert.equal(displayUrl("chrome://gpu/"), "name://gpu");
  assert.equal(toAppUrl("view-source:chrome://version"), "view-source:name://version");
  assert.equal(toAppUrl("about:flags"), "name://flags");
  assert.equal(appUrlOrigin("ardia://settings/sync"), "name://settings");
  assert.deepEqual(breadcrumb("chrome://flags/", "Experiments"), { host: "name://flags", trail: ["Experiments"] });
  assert.deepEqual(breadcrumb("name://history", "History"), { host: "name://history", trail: [] });
});

test("a fork's typed scheme, ardia:// and chrome:// all resolve, and reach the engine as chrome://", () => {
  setAppScheme("Name");
  for (const typed of ["name://version", "ardia://version", "chrome://version", "NAME://version"]) {
    assert.equal(fixupUrl(typed), "name://version", typed);
    assert.equal(resolveInput(typed), "name://version", typed);
  }
  assert.equal(toEngineUrl("name://version"), "chrome://version");
  assert.equal(toEngineUrl("ardia://flags/#x"), "chrome://flags/#x");
  assert.equal(toEngineUrl("view-source:name://version"), "view-source:chrome://version");
  assert.equal(toEngineUrl("https://name.example/"), "https://name.example/");
});

test("a fork routes its own pages from either scheme", () => {
  setAppScheme("Name");
  assert.deepEqual(appUrlRoute("name://history"), { kind: "page", page: "history" });
  assert.deepEqual(appUrlRoute("ardia://bookmarks"), { kind: "page", page: "bookmarks" });
  assert.deepEqual(appUrlRoute("name://settings/sync"), { kind: "settings", section: "sync" });
  assert.deepEqual(appUrlRoute("name://newtab"), { kind: "newTab" });
  assert.deepEqual(appUrlRoute("name://version"), { kind: "engine", url: "chrome://version" });
  assert.equal(appUrlRoute("chrome://version"), null);
});
