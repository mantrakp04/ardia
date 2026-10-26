import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig, type Plugin } from "vite";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const repo = here("../../");
const shims = here("./src/shims/");
const reactNativeWeb = dirname(createRequire(import.meta.url).resolve("react-native-web/package.json"));

const realPackages: Record<string, string> = {
  shell: `${repo}packages/shell/src/index.tsx`,
  ardiacore: `${repo}packages/ardiacore/src/index.ts`,
  shaders: `${repo}packages/shaders/src/index.tsx`,
  sync: `${repo}packages/sync/src/index.ts`,
  import: `${repo}packages/import/src/index.ts`,
};

const ASSET = /\.(png|jpe?g|gif|webp|svg)$/;

function commonJsRequires(): Plugin {
  const scope = [`${repo}apps/browser/src/`, `${repo}packages/`];
  return {
    name: "ardia-demo:requires",
    enforce: "pre",
    transform(code, id) {
      if (!/\.(t|j)sx?$/.test(id) || !scope.some((dir) => id.startsWith(dir)) || !code.includes("require(")) return null;
      const specs: string[] = [];
      const body = code.replace(/\brequire\((["'])([^"']+)\1\)/g, (_match, _quote, spec: string) => {
        let index = specs.indexOf(spec);
        if (index < 0) index = specs.push(spec) - 1;
        return ASSET.test(spec) ? `__required${index}.default` : `__required${index}`;
      });
      if (!specs.length) return null;
      const imports = specs.map((spec, i) => `import * as __required${i} from ${JSON.stringify(spec)};`).join("\n");
      return { code: `${imports}\n${body}`, map: null };
    },
  };
}

const LAZY_COMPONENTS: Record<string, string[]> = {
  [`${repo}apps/browser/src/components/settings/UtilityWindow.tsx`]: ["UtilityWindow"],
  [`${repo}apps/browser/src/components/onboarding/OnboardingOverlay.tsx`]: ["OnboardingOverlay"],
  [`${repo}apps/browser/src/components/pages/InternalPage.tsx`]: ["InternalPage"],
  [`${repo}apps/browser/src/components/extensions/ExtensionOverlays.tsx`]: ["ExtensionOverlays", "InstallDialogHost"],
  [`${repo}apps/browser/src/components/extensions/SidePanel.tsx`]: ["ExtensionSidePanel"],
  [`${repo}apps/browser/src/components/bookmarks/BookmarkDialog.tsx`]: ["BookmarkDialog"],
  [`${repo}apps/browser/src/components/bookmarks/EditBookmarkDialog.tsx`]: ["EditBookmarkDialog"],
  [`${repo}apps/browser/src/components/littleArdia/LittleArdiaWindow.tsx`]: ["LittleArdiaWindow"],
};

const LAZY_PREFIX = "\0ardia-lazy:";
const EAGER_QUERY = "?ardia-eager";

function lazyComponents(): Plugin {
  return {
    name: "ardia-demo:lazy-components",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || source.endsWith(EAGER_QUERY) || importer.startsWith(LAZY_PREFIX)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || !LAZY_COMPONENTS[resolved.id]) return null;
      return LAZY_PREFIX + resolved.id;
    },
    load(id) {
      if (!id.startsWith(LAZY_PREFIX)) return null;
      const file = id.slice(LAZY_PREFIX.length);
      const names = LAZY_COMPONENTS[file]!;
      const lines = [
        `import { createElement, lazy, Suspense } from "react";`,
        `const load = () => import(${JSON.stringify(file + EAGER_QUERY)});`,
        ...names.flatMap((name) => [
          `const Lazy${name} = lazy(() => load().then((m) => ({ default: m.${name} })));`,
          `export function ${name}(props) { return createElement(Suspense, { fallback: null }, createElement(Lazy${name}, props)); }`,
        ]),
      ];
      return lines.join("\n");
    },
  };
}

const analyze = !!process.env.ARDIA_DEMO_ANALYZE;

export default defineConfig({
  plugins: [
    commonJsRequires(),
    lazyComponents(),
    react(),
    analyze && visualizer({ filename: "dist/stats.html", gzipSize: true, template: "treemap" }),
    analyze && visualizer({ filename: "dist/stats.json", gzipSize: true, template: "raw-data" }),
  ],
  define: {
    __DEV__: "false",
    global: "globalThis",
  },
  resolve: {
    dedupe: ["react", "react-dom", "react-native-web"],
    extensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".mjs", ".js", ".jsx", ".json"],
    alias: [
      { find: /^react-native\/Libraries\/Animated\/useAnimatedProps$/, replacement: `${reactNativeWeb}/dist/vendor/react-native/Animated/useAnimatedProps.js` },
      { find: /^react-native(-macos)?$/, replacement: `${shims}react-native.tsx` },
      { find: /^expo-modules-core$/, replacement: `${shims}expo-modules-core.ts` },
      { find: /^(?:\.\.\/)+platform\/webDemo$/, replacement: `${shims}webDemo.ts` },
      { find: /^@ardia\/(shell|ardiacore|shaders|sync|import)$/, replacement: `${shims}$1.tsx` },
      ...Object.entries(realPackages).map(([name, path]) => ({ find: new RegExp(`^@ardia-real/${name}$`), replacement: path })),
    ],
  },
  optimizeDeps: {
    include: ["react-native-web", "lucide-react", "zustand", "zustand/react/shallow", "react-dom/client"],
  },
  server: {
    host: "127.0.0.1",
    port: 5191,
    strictPort: true,
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
  },
});
