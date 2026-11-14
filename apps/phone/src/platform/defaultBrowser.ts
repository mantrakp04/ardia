import { Linking } from "react-native";

export { defaultBrowser } from "@ardia/phone-native";
export type { DefaultBrowserStatus } from "@ardia/phone-native";

export const openAppSettings = () => Linking.openSettings();
