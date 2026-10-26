import { updaterState } from "@ardia/shell";
import { afterFirstWindow } from "../lib/afterFirstWindow";
import { refreshSwitches } from "./killSwitches";

export function startKillSwitches() {
  afterFirstWindow(() => {
    void updaterState().then(
      (state) => {
        if (state.available && state.configured && state.automaticChecks) void refreshSwitches();
      },
      () => {},
    );
  });
}
