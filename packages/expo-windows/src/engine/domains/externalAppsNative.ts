import { TurboModuleRegistry, type TurboModule } from "react-native";
import type { DocumentsNative } from "@ardia/shell";
import type { ExternalAppsModule } from "../../nativeModuleTypes";
import { answerExternalAppsWith, externalAppStillAsked } from "../pages";
import { readExternalAppAsk, windowsExternalApps, type ExternalApps } from "./externalApps";

export function nativeExternalApps(): ExternalApps {
  const apps = windowsExternalApps(
    () => TurboModuleRegistry.get<TurboModule & ExternalAppsModule>("ArdiaExternalApps"),
    () => TurboModuleRegistry.get<TurboModule & DocumentsNative>("ArdiaDocuments"),
    externalAppStillAsked,
  );
  answerExternalAppsWith({
    ask: (profile, page, data) => {
      const ask = readExternalAppAsk(data);
      return ask ? apps.request(ask, profile, page) : Promise.resolve(null);
    },
    forget: apps.forget,
    forgetPage: apps.forgetPage,
  });
  return apps;
}
