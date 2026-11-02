import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

globalThis.__DEV__ ??= false;

const fakes = new Map([
  ["expo-modules-core", new URL("./test-native/expo.ts", import.meta.url).href],
  ["react-native", new URL("./test-native/reactNative.ts", import.meta.url).href],
]);

const tsxCache = new URL("../node_modules/.cache/ardia-test-tsx/", import.meta.url);
let typescript;

function transpiledTsx(url) {
  const source = readFileSync(new URL(url), "utf8");
  const cached = new URL(`${createHash("sha1").update(url).update("\0").update(source).digest("hex")}.mjs`, tsxCache);
  if (existsSync(cached)) return readFileSync(cached, "utf8");
  typescript ??= createRequire(import.meta.url)("typescript");
  const { outputText } = typescript.transpileModule(source, {
    fileName: fileURLToPath(url),
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
      jsx: typescript.JsxEmit.ReactJSX,
    },
  });
  mkdirSync(tsxCache, { recursive: true });
  const partial = new URL(`${cached.pathname.split("/").at(-1)}.${process.pid}`, tsxCache);
  writeFileSync(partial, outputText);
  renameSync(partial, cached);
  return outputText;
}

registerHooks({
  resolve(specifier, context, next) {
    if (fakes.has(specifier)) return { url: fakes.get(specifier), shortCircuit: true };
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith(".")) {
        for (const ext of [".ts", ".tsx"]) {
          try {
            return next(specifier + ext, context);
          } catch {}
        }
      }
      throw error;
    }
  },
  load(url, context, next) {
    if (url.startsWith("file:") && url.endsWith(".tsx")) return { format: "module", source: transpiledTsx(url), shortCircuit: true };
    return next(url, context);
  },
});
