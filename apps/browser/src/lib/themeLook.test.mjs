import assert from "node:assert/strict";
import { test } from "node:test";
const { DEFAULT_LOOK, RADII, ROW_METRICS, TYPE_SIZES, WEIGHTS, lookDefaults, lookSchemas, lookUse, parseLookBlocks, resolveLook } = await import("./themeLook.ts");

const parse = (doc) => {
  const problems = [];
  return { blocks: parseLookBlocks("themes/t.json", doc, problems), problems };
};

test("no look blocks, or empty ones, resolve to Ardia's own look object", () => {
  assert.equal(resolveLook(null), DEFAULT_LOOK);
  assert.equal(resolveLook({}), DEFAULT_LOOK);
  assert.equal(resolveLook(parse({ dark: {} }).blocks), DEFAULT_LOOK);
  assert.deepEqual(DEFAULT_LOOK.sizes, TYPE_SIZES);
  assert.deepEqual(DEFAULT_LOOK.weights, WEIGHTS);
  assert.deepEqual(DEFAULT_LOOK.metrics, ROW_METRICS);
  assert.deepEqual(DEFAULT_LOOK.radii, RADII);
  assert.equal(DEFAULT_LOOK.family, null);
  assert.equal(DEFAULT_LOOK.mono, "Menlo");
  assert.equal(DEFAULT_LOOK.hidden.size, 0);
  assert.equal(DEFAULT_LOOK.addressField, "top");
  assert.equal(DEFAULT_LOOK.newTab, null);
  assert.equal(DEFAULT_LOOK.icons.size, 0);
});

test("type: family, mono, per-size overrides, a scale over every size, and weights", () => {
  const { blocks, problems } = parse({ type: { family: "Avenir Next", mono: "SF Mono", scale: 1.1, sizes: { body: 14 }, weights: { medium: "600", bold: 800 } } });
  assert.deepEqual(problems, []);
  const look = resolveLook(blocks);
  assert.equal(look.family, "Avenir Next");
  assert.equal(look.mono, "SF Mono");
  assert.equal(look.sizes.body, 15.4);
  assert.equal(look.sizes.small, 13.2);
  assert.equal(look.sizes.large, 18.7);
  assert.deepEqual(look.weights, { regular: "400", medium: "600", semibold: "600", bold: "800" });
});

test("metrics and radii replace Ardia's, each one on its own", () => {
  const look = resolveLook(parse({ metrics: { rowHeight: 40, rowGap: 6, pinnedHeight: 50, sidebarWidth: 260, radius: { row: 14, pinned: 18, panel: 20 } } }).blocks);
  assert.deepEqual(look.metrics, { rowHeight: 40, rowGap: 6, pinnedHeight: 50 });
  assert.equal(look.sidebarWidth, 260);
  assert.equal(resolveLook(parse({ metrics: { rowHeight: 40 } }).blocks).sidebarWidth, null);
  assert.equal(look.radii.chrome, 14);
  assert.equal(look.radii.pinned, 18);
  assert.equal(look.radii.panel, 20);
  assert.equal(look.radii.tile, RADII.tile);
  assert.equal(look.radii.hero, RADII.hero);
});

test("layout hides named parts and moves the address field and the New Tab row", () => {
  const look = resolveLook(parse({ layout: { hide: ["pinned", "newTab", "pinned"], addressField: "bottom", newTab: "top" } }).blocks);
  assert.deepEqual([...look.hidden], ["pinned", "newTab"]);
  assert.equal(look.addressField, "bottom");
  assert.equal(look.newTab, "top");
});

test("icons map SF Symbol names to others", () => {
  const look = resolveLook(parse({ icons: { plus: "plus.circle", "sidebar.left": "rectangle.lefthalf.inset.filled" } }).blocks);
  assert.equal(look.icons.get("plus"), "plus.circle");
  assert.equal(look.icons.get("sidebar.left"), "rectangle.lefthalf.inset.filled");
  assert.equal(look.icons.get("constructor"), undefined);
});

test("every bad key or value is reported in the app's words, and the good rest still applies", () => {
  const { blocks, problems } = parse({
    type: { family: "", mono: " Menlo", scale: 3, sizes: { body: 40, huge: 30, small: 12 }, weights: { medium: "550", bold: "700" }, color: 1 },
    metrics: { rowHeight: 10, rowGap: "3", pinnedHeight: 60, radius: { row: 99, card: 4, tile: 6 } },
    layout: { hide: ["pinned", "toolbar", 3], addressField: "left", newTab: "bottom" },
    icons: { plus: "", "Bad Name": "x", minus: "minus.circle" },
  });
  assert.deepEqual(problems, [
    "themes/t.json: type.family must be a font family name (1 to 64 characters, no space at either end)",
    "themes/t.json: type.mono must be a font family name (1 to 64 characters, no space at either end)",
    "themes/t.json: type.scale must be a number from 0.85 to 1.3",
    "themes/t.json: type.sizes.body must be a number from 10 to 21",
    "themes/t.json: type.sizes.huge isn't a text size key (badge, tiny, caption, small, body, title, large)",
    'themes/t.json: type.weights.medium must be a weight from "100" to "900" in steps of 100',
    "themes/t.json: type.color isn't a type key (family, mono, scale, sizes, weights)",
    "themes/t.json: metrics.rowHeight must be a number from 24 to 56",
    "themes/t.json: metrics.rowGap must be a number from 0 to 12",
    "themes/t.json: metrics.radius.row must be a number from 0 to 24",
    "themes/t.json: metrics.radius.card isn't a radius key (row, pinned, tile, control, toolbar, panel, sheet)",
    'themes/t.json: layout.hide has "toolbar", which isn\'t a part (pinned, newTab, addressField, navButtons, sidebarButton, downloads, profile)',
    "themes/t.json: layout.hide has 3, which isn't a part (pinned, newTab, addressField, navButtons, sidebarButton, downloads, profile)",
    "themes/t.json: layout.addressField must be one of top, bottom",
    "themes/t.json: icons.plus must be an SF Symbol name (lowercase letters, digits and dots)",
    'themes/t.json: icons has "Bad Name", which isn\'t an SF Symbol name (lowercase letters, digits and dots)',
  ]);
  const look = resolveLook(blocks);
  assert.equal(look.sizes.small, 12);
  assert.equal(look.weights.bold, "700");
  assert.equal(look.metrics.pinnedHeight, 60);
  assert.equal(look.metrics.rowHeight, ROW_METRICS.rowHeight);
  assert.equal(look.radii.tile, 6);
  assert.deepEqual([...look.hidden], ["pinned"]);
  assert.equal(look.newTab, "bottom");
  assert.equal(look.addressField, "top");
  assert.deepEqual([...look.icons], [["minus", "minus.circle"]]);
});

test("a block that isn't an object is reported and ignored", () => {
  const { blocks, problems } = parse({ type: "Avenir", metrics: [], layout: { hide: "pinned" }, icons: 3 });
  assert.deepEqual(problems, [
    "themes/t.json: type must be an object",
    "themes/t.json: metrics must be an object",
    "themes/t.json: layout.hide must be a list of parts (pinned, newTab, addressField, navButtons, sidebarButton, downloads, profile)",
    "themes/t.json: icons must be an object of SF Symbol names",
  ]);
  assert.equal(resolveLook(blocks), DEFAULT_LOOK);
});

test("the schema's defaults are Ardia's own look, and lookDefaults writes the same values", () => {
  const schemas = lookSchemas();
  assert.equal(schemas.type.properties.sizes.properties.body.default, TYPE_SIZES.body);
  assert.equal(schemas.type.properties.mono.default, "Menlo");
  assert.equal("default" in schemas.type.properties.family, false);
  assert.equal(schemas.metrics.properties.rowHeight.default, ROW_METRICS.rowHeight);
  assert.equal("default" in schemas.metrics.properties.sidebarWidth, false, "a new theme leaves the sidebar's width alone");
  assert.equal(schemas.metrics.properties.radius.properties.row.default, RADII.chrome);
  assert.equal(schemas.layout.properties.addressField.default, "top");
  const defaults = lookDefaults();
  assert.equal(resolveLook(defaults).sizes.body, TYPE_SIZES.body);
  assert.deepEqual(resolveLook(defaults).metrics, ROW_METRICS);
  assert.deepEqual(resolveLook(defaults).radii, RADII);
  assert.equal(resolveLook(defaults).newTab, null);
  assert.equal(resolveLook(defaults).sidebarWidth, null);
  assert.equal(resolveLook(defaults).family, null);
  const { problems } = parse(defaults);
  assert.deepEqual(problems, []);
});

test("lookUse counts what a theme changes, as flags and counts only", () => {
  assert.deepEqual(lookUse(null), { type: false, metrics: false, layout: false, icons: false, hidden: 0, moved: 0, iconOverrides: 0 });
  const blocks = parse({ type: { family: "Avenir Next" }, layout: { hide: ["pinned", "profile"], addressField: "bottom" }, icons: { plus: "plus.circle" } }).blocks;
  assert.deepEqual(lookUse(blocks), { type: true, metrics: false, layout: true, icons: true, hidden: 2, moved: 1, iconOverrides: 1 });
});
