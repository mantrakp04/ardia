import { confirm } from "@ardia/shell";

export async function confirmAdClicking(windowId?: string) {
  const { confirmed } = await confirm({
    windowId,
    title: "Enable Active Obfuscation?",
    message:
      "Ardia will use AdNauseam to collect hidden ads in a local vault and visit eligible ads in the background, intended to add noise to advertising profiles. This uses extra data and shares your IP address with advertising services. Private tabs are excluded. The privacy benefit is not guaranteed. Switch to Standard in Settings › Privacy to stop collection and visits.",
    confirmTitle: "Enable Active Obfuscation",
    cancelTitle: "Cancel",
  });
  return confirmed;
}
