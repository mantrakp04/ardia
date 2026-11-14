import { requireOptionalNativeModule } from "expo-modules-core";

export type DefaultBrowserStatus = { isDefault: boolean; canAsk: boolean };

type DefaultBrowserNative = {
  status(): Promise<DefaultBrowserStatus>;
  requestRole(): Promise<boolean>;
  openDefaultAppsSettings(): Promise<void>;
};

const native = requireOptionalNativeModule<DefaultBrowserNative>("ArdiaPhoneDefaultBrowser");

export const defaultBrowser = {
  status: async (): Promise<DefaultBrowserStatus> => (native ? native.status() : { isDefault: false, canAsk: false }),
  requestRole: async (): Promise<boolean> => (native ? native.requestRole() : false),
  openDefaultAppsSettings: async (): Promise<void> => {
    if (native) await native.openDefaultAppsSettings();
  },
};
