import { create } from "zustand";
import "../../platform/copy";
import { importLegacyStore } from "../legacy/importer";

export const useBoot = create<{ ready: boolean }>()(() => ({ ready: false }));

let booting = false;

export function bootApp(start: () => void) {
  if (booting) return;
  booting = true;
  void importLegacyStore()
    .catch(() => console.log("ardia-legacy import failed before writing"))
    .finally(() => {
      start();
      useBoot.setState({ ready: true });
    });
}
