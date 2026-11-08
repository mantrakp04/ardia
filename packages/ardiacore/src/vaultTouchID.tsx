import { requireNativeViewManager } from "expo-modules-core";
import type { NativeSyntheticEvent, ViewProps } from "react-native";

export type VaultTouchIDStatus = "ready" | "retry" | "granted" | "unavailable" | "lockout";

export type VaultTouchIDProps = ViewProps & {
  armed: boolean;
  onStatus?: (status: VaultTouchIDStatus) => void;
};

type NativeProps = Omit<VaultTouchIDProps, "onStatus"> & {
  onStatus?: (e: NativeSyntheticEvent<{ status: VaultTouchIDStatus }>) => void;
};

let Native: React.ComponentType<NativeProps> | undefined;
const native = () => (Native ??= requireNativeViewManager<NativeProps>("ArdiaVaults"));

export function VaultTouchID({ onStatus, ...props }: VaultTouchIDProps) {
  const View = native();
  return <View {...props} onStatus={onStatus ? (e) => onStatus(e.nativeEvent.status) : undefined} />;
}
