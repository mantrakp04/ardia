import type { Check } from "./check";
import { checks as appSystemChecks } from "./appSystem";
import { checks as shellChecks } from "./shell";
import { checks as storageChecks } from "./storage";
import { checks as windowChecks } from "./windows";

const areas: Check[][] = [windowChecks, appSystemChecks, shellChecks, storageChecks];

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function runSelfCheck() {
  let passed = 0;
  let failed = 0;
  for (const check of areas.flat()) {
    try {
      await check.run();
      passed += 1;
      console.info(`[ardia windows] self-check pass: ${check.name}`);
    } catch (error) {
      failed += 1;
      console.info(`[ardia windows] self-check FAIL: ${check.name}: ${message(error)}`);
    }
  }
  console.info(`[ardia windows] self-check done: ${passed} passed, ${failed} failed`);
}
