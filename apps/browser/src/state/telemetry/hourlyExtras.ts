import { takeAnimationBursts, watchAnimationBursts } from "./animationBursts";
import { takeImportRuns } from "./importRuns";

export { watchAnimationBursts };

export const takeHourlyExtras = () => ({ ...takeAnimationBursts(), ...takeImportRuns() });
