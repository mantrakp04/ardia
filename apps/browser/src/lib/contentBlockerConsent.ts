import { confirm } from "@ardia/shell";

export async function confirmAdClicking(windowId?: string) {
  const { confirmed } = await confirm({
    windowId,
    title: "Use AdNauseam with Background Clicking?",
    message:
      "AdNauseam will send background requests that simulate clicks on hidden ads, intended to confuse advertising profiles. This uses extra data. Background clicking is part of choosing AdNauseam. To stop it, switch to uBlock Origin in Settings › Privacy.",
    confirmTitle: "Use AdNauseam",
    cancelTitle: "Cancel",
  });
  return confirmed;
}
