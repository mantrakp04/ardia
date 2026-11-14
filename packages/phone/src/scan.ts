import { createElement, type ComponentType } from "react";
import { requireNativeViewManager, requireOptionalNativeModule } from "expo-modules-core";
import type { NativeSyntheticEvent, ViewProps } from "react-native";

export type ScanPermission = { status: "granted" | "denied" | "undetermined" | "unsupported"; canAskAgain: boolean };

export type ScanError = "permission" | "unsupported" | "camera";

export type ScanViewProps = ViewProps & {
  active?: boolean;
  onCode: (text: string) => void;
  onRejected?: () => void;
  onError?: (error: ScanError) => void;
};

type NativeScanProps = ViewProps & {
  active?: boolean;
  onCode: (event: NativeSyntheticEvent<{ text: string }>) => void;
  onRejected?: () => void;
  onError?: (event: NativeSyntheticEvent<{ code: ScanError }>) => void;
};

type ScanNative = {
  permission(): Promise<ScanPermission>;
  requestPermission(): Promise<ScanPermission>;
};

const native = requireOptionalNativeModule<ScanNative>("ArdiaPhoneScan");

let view: ComponentType<NativeScanProps> | undefined;
const nativeView = () => (view ??= requireNativeViewManager<NativeScanProps>("ArdiaPhoneScan"));

export function ScanView({ onCode, onRejected, onError, ...rest }: ScanViewProps) {
  return createElement(nativeView(), {
    ...rest,
    onCode: (event) => onCode(event.nativeEvent.text),
    onRejected: () => onRejected?.(),
    onError: (event) => onError?.(event.nativeEvent.code),
  });
}

const unavailable: ScanPermission = { status: "unsupported", canAskAgain: false };

export const scanner = {
  isAvailable: () => native !== null,
  permission: async (): Promise<ScanPermission> => (native ? native.permission() : unavailable),
  requestPermission: async (): Promise<ScanPermission> => (native ? native.requestPermission() : unavailable),
};
