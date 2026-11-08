import { requireNativeViewManager } from "expo-modules-core";
import type { NativeSyntheticEvent, ViewProps } from "react-native";

export type VaultTouchIDEnd = { reason: "lockout" | "unavailable" | "failed" };

export type VaultTouchIDProps = ViewProps & {
  armed: boolean;
  onEnded?: (end: VaultTouchIDEnd) => void;
};

type NativeProps = Omit<VaultTouchIDProps, "onEnded"> & {
  onEnded?: (e: NativeSyntheticEvent<VaultTouchIDEnd>) => void;
};

let Native: React.ComponentType<NativeProps> | undefined;
const native = () => (Native ??= requireNativeViewManager<NativeProps>("ArdiaVaults"));

export function VaultTouchID({ onEnded, ...props }: VaultTouchIDProps) {
  const View = native();
  return <View {...props} onEnded={onEnded ? (e) => onEnded(e.nativeEvent) : undefined} />;
}
