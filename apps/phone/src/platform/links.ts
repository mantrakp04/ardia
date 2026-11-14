import { system, type SystemLink } from "@ardia/phone-native";

export type { SystemLink };

export const initialLink = () => system.initialLink();

export const addLinkListener = (listener: (link: SystemLink) => void) => system.addLinkListener(listener);
