import { confirm } from "../../platform/dialogs";
import { locationPermission, openLocationSettings, requestLocationPermission, type LocationPermission } from "../../platform/location";
import { capture } from "../telemetry/client";

let toldAboutSettings = false;

const noteLocationAccess = (outcome: "granted" | "denied_by_user" | "denied_by_system" | "error") => capture("location_access", { outcome });

const blockedBySystem = (status: LocationPermission) => status === "denied" || status === "restricted" || status === "servicesOff";

export async function ensureLocationPermission(windowId?: string): Promise<boolean> {
  let status: LocationPermission;
  try {
    status = await locationPermission();
    if (status === "notDetermined") {
      status = await requestLocationPermission();
      if (status === "granted") noteLocationAccess("granted");
      else if (blockedBySystem(status)) noteLocationAccess("denied_by_user");
      else noteLocationAccess("error");
      return status === "granted";
    }
  } catch {
    noteLocationAccess("error");
    return false;
  }
  if (status === "granted") {
    noteLocationAccess("granted");
    return true;
  }
  noteLocationAccess("denied_by_system");
  if (toldAboutSettings) return false;
  toldAboutSettings = true;
  const off = status === "servicesOff";
  const { confirmed } = await confirm({
    title: off ? "Location Services Are Off" : "Ardia Needs Location Permission",
    message: off
      ? "Turn on Location Services in System Settings so websites you allow can use your location."
      : "You need to open System Settings to give Ardia permission to use your location.",
    confirmTitle: "Open System Settings",
    cancelTitle: "Not Now",
    windowId,
  });
  if (confirmed) void openLocationSettings();
  return false;
}
