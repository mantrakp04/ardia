import {
  cancelDeviceChooser,
  onDeviceChooser,
  openBluetoothSettings,
  refreshDeviceChooser,
  selectDevice,
  type DeviceChooser,
} from "../../platform/permissions";
import { create } from "zustand";
import { useBrowser } from "../browser/store";

const useChoosers = create<{ byTab: Record<string, DeviceChooser> }>()(() => ({ byTab: {} }));
if (__DEV__) (globalThis as { acDeviceChoosers?: unknown }).acDeviceChoosers = { useChoosers, selectDevice, cancelDeviceChooser };

export const useDeviceChooser = (tabId: string): DeviceChooser | undefined => useChoosers((s) => s.byTab[tabId]);

export const chooseDevice = (chooserId: number, index: number) => void selectDevice(chooserId, index);
export const cancelChooser = (chooserId: number) => void cancelDeviceChooser(chooserId);
export const rescanDevices = (chooserId: number) => void refreshDeviceChooser(chooserId);
export const openChooserBluetoothSettings = (chooserId: number) => void openBluetoothSettings(chooserId);

let started = false;
export function startDeviceChoosers() {
  if (started) return;
  started = true;
  onDeviceChooser((chooser) => {
    const tabId = chooser.tabId;
    if (!tabId) {
      if (chooser.open) void cancelDeviceChooser(chooser.id);
      return;
    }
    useChoosers.setState((s) => {
      const byTab = { ...s.byTab };
      if (chooser.open) byTab[tabId] = chooser;
      else if (byTab[tabId]?.id === chooser.id) delete byTab[tabId];
      return { byTab };
    });
  });
  useBrowser.subscribe((s, prev) => {
    if (s.tabs === prev.tabs) return;
    const { byTab } = useChoosers.getState();
    const gone = Object.keys(byTab).filter((id) => !s.tabs[id]);
    if (!gone.length) return;
    const next = { ...byTab };
    for (const id of gone) delete next[id];
    useChoosers.setState({ byTab: next });
  });
}
