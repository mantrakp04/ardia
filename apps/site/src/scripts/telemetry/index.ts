import { enabled } from "./core";
import { startAutocapture } from "./autocapture";
import { startErrors } from "./errors";
import { registerFlags } from "./flags";
import { startReplay } from "./replay";
import { startVitals } from "./vitals";

if (enabled) {
  startErrors();
  startAutocapture();
  void registerFlags();
  startVitals();
  startReplay();
}

export { capture, type Props } from "./core";
export { getFeatureFlag } from "./flags";
