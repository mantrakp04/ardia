import { fileURLToPath } from "node:url";

export const HERE = fileURLToPath(new URL(".", import.meta.url));
export const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
export const SYMBOLS_DIR = `${REPO}packages/demo/src/shims/web/symbols/`;
export const SCRATCH = process.env.ARDIA_ICONS_SCRATCH ?? "/tmp/ardia-icons";
export const NATIVE = `${SCRATCH}/native`;
