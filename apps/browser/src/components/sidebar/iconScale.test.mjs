import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire, registerHooks } from "node:module";
const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const boundary = "data:text/javascript,export const Symbol=()=>null;export const Text=()=>null;export const Favicon=()=>null;";
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith("/sidebar/TabIcon.tsx") && ["../ui", "../favicon/Favicon"].includes(specifier)) return { url: boundary, shortCircuit: true };
    return next(specifier, context);
  },
});
const { TabIcon } = await import("./TabIcon.tsx");
const { SidebarScaleContext, sidebarScale } = await import("./scale.ts");
const { SIDEBAR_SCALES } = await import("../../lib/sidebarMetrics.ts");

function iconAt(percent, size, marks) {
  let result;
  function Probe() {
    result = TabIcon.type({ tabId: "marked-tab", url: "https://example.com", size, marks });
    return null;
  }
  renderToStaticMarkup(React.createElement(SidebarScaleContext.Provider, { value: sidebarScale(percent) }, React.createElement(Probe)));
  return result.props.children[1];
}

test("engine badges stay visible on scaled sidebar favicons at every offered size", () => {
  for (const percent of SIDEBAR_SCALES) {
    const size = sidebarScale(percent).icon;
    assert.equal(iconAt(percent, size, 64)?.props.mark, "webkit", `${percent}% WebKit`);
    assert.equal(iconAt(percent, size, 32)?.props.mark, "chromium", `${percent}% Chromium`);
    assert.equal(iconAt(percent, size, 0), null);
  }
});

test("small icons outside the scaled sidebar keep their existing badge threshold", () => {
  assert.equal(iconAt(100, 12, 64), null);
  assert.equal(iconAt(100, 14, 64)?.props.mark, "webkit");
});
