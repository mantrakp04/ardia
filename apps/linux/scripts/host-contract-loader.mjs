import "./host-test-loader.mjs";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "expo-modules-core") return { url: new URL("../src/shims/expo-modules-core.ts", import.meta.url).href, shortCircuit: true };
    try { return next(specifier, context); } catch (error) {
      if (specifier.startsWith(".")) {
        try { return next(`${specifier}.ts`, context); } catch {}
      }
      throw error;
    }
  },
});
