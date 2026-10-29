import "../../browser/src/test-loader.mjs";
import { registerHooks } from "node:module";

const native = new URL("./host-test-native.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "react-native") return { url: native, shortCircuit: true };
    return next(specifier, context);
  },
});
