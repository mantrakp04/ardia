import { call, on, type DeviceChooser, type PermissionKind, type PermissionRequest, type PermissionResult } from "@ardia/ardiacore";

export type { PermissionKind, PermissionRequest, PermissionResult, DeviceChooser };

export const onPermission = (listener: (p: PermissionRequest) => void) => on("permissions.requested", listener);
export const onPermissionDismissed = (listener: (p: { id: string }) => void) => on("permissions.dismissed", listener);
export const resolvePermission = (id: string, result: PermissionResult, remember = false) => call("permissions.resolve", { id, result, remember });

export const onDeviceChooser = (listener: (e: DeviceChooser) => void) => on("media.deviceChooser", listener);
export const selectDevice = (id: number, index: number) => call("media.selectDevice", { id, index });
export const cancelDeviceChooser = (id: number) => call("media.cancelDeviceChooser", { id });
export const refreshDeviceChooser = (id: number) => call("media.refreshDeviceChooser", { id });
export const openBluetoothSettings = (id: number) => call("media.openBluetoothSettings", { id });
