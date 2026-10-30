import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { mount } from "../../test-hooks.mjs";

const stubs = {
  "react-native": `
    export const Animated = { View: "Animated.View" };
    export const View = "View";
    export const Pressable = "Pressable";
    export const StyleSheet = { absoluteFill: {} };
    export const PanResponder = { create: () => ({ panHandlers: {} }) };
  `,
  "../../state/bookmarks/actions": "export const openModeFor = () => {}; export const openUrl = () => {};",
  "../../state/bookmarks/barDrag": `
    export const useBarDrag = (select) => select({ source: null, spot: null });
    export const barDragging = () => false;
    export const beginBookmarkDrag = () => {};
    export const endBookmarkDrag = () => {};
    export const moveBookmarkDrag = () => {};
  `,
  "../../state/settings/settingsWindows": "export const openImport = () => {};",
  "../../state/sidebar/hooks": "export const useSidebarWidth = () => 240;",
  "../../state/bookmarks/barMenus": "export const openBarMenu = () => {}; export const openImportButtonMenu = () => {};",
  "../favicon/Favicon": "export const Favicon = 'Favicon';",
  "../ui": `
    export const ContextMenuArea = "ContextMenuArea";
    export const MouseArea = "MouseArea";
    export const Symbol = "Symbol";
    export const Text = "Text";
    export const useHover = () => ({ hovered: false, hoverProps: {} });
    export const useTheme = () => ({});
  `,
  "./barMotion": "export const measureRect = async () => null; export const useEased = () => 0; export const useSlide = () => 0;",
};

registerHooks({
  resolve(specifier, context, next) {
    if (!context.parentURL?.endsWith("/bookmarks/BarItem.tsx") || !(specifier in stubs)) return next(specifier, context);
    return { url: `data:text/javascript,${encodeURIComponent(stubs[specifier])}`, shortCircuit: true };
  },
});

const { useBrowser } = await import("../../state/browser/store.ts");
const { BarItem } = await import("./BarItem.tsx");

function render(element) {
  if (element == null || typeof element !== "object") return element;
  if (Array.isArray(element)) return element.flatMap((child) => render(child) ?? []);
  if (typeof element.type !== "string") {
    const component = typeof element.type === "function" ? element.type : element.type.render;
    const instance = mount(() => component(element.props, null));
    try {
      return render(instance.value);
    } finally {
      instance.unmount();
    }
  }
  const children = typeof element.props.children === "function" ? element.props.children({ pressed: false }) : element.props.children;
  return { type: element.type, props: element.props, children: render(children) };
}

function find(tree, type) {
  if (!tree || typeof tree !== "object") return [];
  if (Array.isArray(tree)) return tree.flatMap((child) => find(child, type));
  return [...(tree.type === type ? [tree] : []), ...find(tree.children, type)];
}

for (const [title, showUrls, label, iconOnlyWidth] of [["", false, null, 30], ["", true, "https://example.com/", undefined], ["Example", false, "Example", undefined]]) {
  test(`bookmark label ${JSON.stringify(title)} with untitled URLs ${showUrls ? "on" : "off"}`, () => {
    const state = () => useBrowser.getState();
    state().hydrate({});
    const windowId = state().createWindow({ url: "https://start.example/" });
    state().updateSettings({ showUntitledBookmarkUrls: showUrls });
    const id = state().addBookmark({ profileId: "default", title, url: "https://example.com/", favicon: null });
    const tree = render({ type: BarItem, props: { id, windowId, profileId: "default", hidden: false, offset: 0, onLayout: () => {} } });
    assert.deepEqual(find(tree, "Text").map((text) => text.children), label === null ? [] : [label]);
    assert.equal(find(tree, "View").find((view) => view.props.tooltip)?.props.tooltip, title ? `${title}\nhttps://example.com/` : "https://example.com/");
    assert.equal(find(tree, "Pressable")[0]?.props.accessibilityLabel, title || "https://example.com/");
    assert.equal(find(tree, "Favicon").length, 1);
    const chip = find(tree, "View").find((view) => view.props.style && "maxWidth" in view.props.style);
    assert.equal(chip.props.style.width, iconOnlyWidth);
  });
}
