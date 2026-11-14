import { requireOptionalNativeModule } from "expo-modules-core";
import type { Subscription } from "./pageTypes";

export type NetworkEvent = { online: boolean };

type NetworkNative = {
  isOnline(): boolean;
  addListener(eventName: "onNetwork", listener: (event: NetworkEvent) => void): Subscription;
};

const native = requireOptionalNativeModule<NetworkNative>("ArdiaPhoneNetwork");

export const network = {
  isOnline: (): boolean => (native ? native.isOnline() : true),
  addOnlineAgainListener: (listener: () => void): Subscription =>
    native ? native.addListener("onNetwork", (event) => event.online && listener()) : { remove() {} },
  addListener: (listener: (event: NetworkEvent) => void): Subscription => (native ? native.addListener("onNetwork", listener) : { remove() {} }),
};
