import { requireOptionalNativeModule } from "expo-modules-core";

export type ClipboardOffer = "link" | "text";

type ClipboardNative = { offer(): Promise<ClipboardOffer | null> };

const native = requireOptionalNativeModule<ClipboardNative>("ArdiaPhoneClipboard");

export const clipboard = {
  offer: async (): Promise<ClipboardOffer | null> => (native ? native.offer() : null),
};
