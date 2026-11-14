import { network } from "@ardia/phone-native";

export const addOnlineAgainListener = (listener: () => void) => network.addOnlineAgainListener(listener);
