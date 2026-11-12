import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transpileModule, ModuleKind, JsxEmit } from "typescript";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const theme = { dark: true, windowTint: ["#101010"], grain: 0.2, backdrop: { tintColor: "#336699", tintAlpha: 0.36 } };
globalThis.sidebarMaterialTest = { enabled: false, available: true, theme };
const react = JSON.stringify(import.meta.resolve("react"));
const view = `import { createElement } from ${react}; export const View = ({ children, onLayout, ...props }) => createElement("div", {"data-view": JSON.stringify(props)}, children); export const StyleSheet = { absoluteFill: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0 } };`;
const marker = `import { createElement } from ${react}; const mark = kind => props => createElement("div", {"data-kind": kind, "data-props": JSON.stringify(props)}); export const Panel = mark("panel"); export const GlassBackdrop = mark("glass"); export const WindowBackdrop = mark("backdrop"); export const liquidGlass = globalThis.sidebarMaterialTest.available;`;
let instance = 0;
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.includes("SidebarMaterial.tsx")) {
      const mocks = {
        "react-native": view,
        "../../state/browser/hooks": "export const useSettings = select => select({ glassSidebar: globalThis.sidebarMaterialTest.enabled });",
        "../ui": marker.replace("globalThis.sidebarMaterialTest.available", JSON.stringify(globalThis.sidebarMaterialTest.available)),
        "../ui/theme": "export const useTheme = () => globalThis.sidebarMaterialTest.theme;",
        "./tokens": "export const SHADOWS = { sidebarPeek: { radius: 1 } };",
      };
      if (mocks[specifier]) return { url: `data:text/javascript,${encodeURIComponent(mocks[specifier])}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.includes("SidebarMaterial.tsx?")) {
      const { outputText } = transpileModule(readFileSync(new URL(url), "utf8"), { compilerOptions: { module: ModuleKind.ESNext, jsx: JsxEmit.ReactJSX } });
      return { format: "module", source: outputText, shortCircuit: true };
    }
    return next(url, context);
  },
});

const props = { peeking: true, radius: 12, left: 7, top: 7, bottom: 7, right: true, windowWidth: 1000, bleed: 0 };
async function render({ enabled, available = true, peeking = true }) {
  globalThis.sidebarMaterialTest.enabled = enabled;
  globalThis.sidebarMaterialTest.available = available;
  const { SidebarMaterial } = await import(`./SidebarMaterial.tsx?case=${instance++}`);
  return renderToStaticMarkup(createElement(SidebarMaterial, { ...props, peeking }));
}

test("glass replaces the opaque backdrop while preserving radius and profile tint", async () => {
  const html = await render({ enabled: true });
  assert.ok(html.includes('data-kind="glass"'));
  assert.ok(!html.includes('data-kind="backdrop"'));
  assert.ok(html.includes("#00000000"));
  assert.ok(html.includes("#3366995C"));
  assert.ok(html.includes("&quot;radius&quot;:12"));
  assert.ok(html.includes("&quot;dark&quot;:true"));
});

test("off keeps the existing right-side themed backdrop", async () => {
  const html = await render({ enabled: false });
  assert.ok(!html.includes('data-kind="glass"'));
  assert.ok(html.includes('data-kind="backdrop"'));
  assert.ok(html.includes("#101010"));
  assert.ok(html.includes("&quot;right&quot;:-7"));
  assert.ok(html.includes("&quot;width&quot;:1000"));
});

test("older macOS falls back to the existing backdrop", async () => {
  const html = await render({ enabled: true, available: false });
  assert.ok(!html.includes('data-kind="glass"'));
  assert.ok(html.includes('data-kind="backdrop"'));
});

test("a docked sidebar never creates an extra glass or blur layer", async () => {
  const html = await render({ enabled: true, peeking: false });
  assert.ok(!html.includes('data-kind="glass"'));
  assert.ok(!html.includes('data-kind="backdrop"'));
});
