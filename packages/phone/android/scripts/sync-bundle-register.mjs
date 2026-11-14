import { register } from "node:module";

const bundle = process.env.ARDIA_SYNC_BUNDLE;
if (!bundle) throw new Error("ARDIA_SYNC_BUNDLE must name the bundle the companion tests run against");
register("./sync-bundle-hooks.mjs", import.meta.url, { data: { bundle } });
