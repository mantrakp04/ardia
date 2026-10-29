import "../../browser/src/test-loader.mjs";
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { inputAdapters, rawBookmarkAdapter, resolveInputAdapter } from "../inputAdapters.ts";

const adapters = new Set([...inputAdapters.values(), rawBookmarkAdapter.replacement].map((path) => pathToFileURL(path).href));
const nativeFixture = new URL("./input-test-native.mjs", import.meta.url).href;
const hostFixture = new URL("./input-test-host.mjs", import.meta.url).href;
const resourceFixture = new URL("./input-test-resources.mjs", import.meta.url).href;
const resources = new URL("../../browser/src/state/settings/resources.ts", import.meta.url).href;
const host = new URL("../src/host.ts", import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "zustand" && context.parentURL === resources) return { url: resourceFixture, shortCircuit: true };
    if (specifier === "react-native") return { url: nativeFixture, shortCircuit: true };
    const resolved = next(specifier, context);
    if (resolved.url === host) return { url: hostFixture, shortCircuit: true };
    if (!resolved.url.startsWith("file:") || adapters.has(context.parentURL)) return resolved;
    const replacement = resolveInputAdapter(fileURLToPath(resolved.url), context.parentURL?.startsWith("file:") ? fileURLToPath(context.parentURL) : "");
    return replacement ? { url: pathToFileURL(replacement).href, shortCircuit: true } : resolved;
  },
});
