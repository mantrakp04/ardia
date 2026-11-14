import { legacy } from "../../platform/legacy";
import { settled } from "../pages/store";
import { hasBrowserData, readPreferences, writeImport, writeMarker } from "../store/browserDatabase";
import { browserDatabase } from "../store/database";
import { importPlan, importStep, LEGACY_IMPORT_KEY, LEGACY_IMPORT_VERSION, LEGACY_SKIPPED } from "./importRules";

const markImported = () => settled(() => legacy.markImported(), undefined);

export async function importLegacyStore(): Promise<void> {
  const db = browserDatabase();
  const marker = readPreferences(db)[LEGACY_IMPORT_KEY] ?? null;
  const available = await settled(() => legacy.available(), false);
  const step = importStep({ available, marker, hasData: hasBrowserData(db) });
  if (step === "none") return;
  if (step === "done") {
    await markImported();
    return;
  }
  if (step === "markExisting") {
    writeMarker(db, LEGACY_IMPORT_KEY, LEGACY_SKIPPED);
    console.log("ardia-legacy skipped: this app already has tabs or history");
    await markImported();
    return;
  }
  const data = await settled(() => legacy.read(), null);
  if (!data) {
    console.log("ardia-legacy read failed: nothing imported, retried next launch");
    return;
  }
  const plan = importPlan(data);
  try {
    writeImport(db, plan, LEGACY_IMPORT_KEY, LEGACY_IMPORT_VERSION);
  } catch (error) {
    console.log(`ardia-legacy import rolled back: ${error instanceof Error ? error.name : "error"} tabs=${plan.tabs.length} visits=${plan.visits.length}`);
    return;
  }
  const archived = plan.tabs.filter((tab) => tab.archivedAt !== null).length;
  console.log(
    `ardia-legacy imported tabs=${plan.tabs.length - archived} archive=${archived} states=${plan.states.length} visits=${plan.visits.length} preferences=${Object.keys(plan.preferences).length} unmapped=${plan.unmapped.length}`,
  );
  await markImported();
}
