import { requireNativeViewManager } from "expo-modules-core";
import type { NativeSyntheticEvent, ViewProps } from "react-native";

export type VaultPasswordFieldProps = ViewProps & {
  draft: string;
  revealed: boolean;
  placeholder?: string;
  onEdit?: (length: number) => void;
  onSubmit?: () => void;
  onEscape?: () => void;
};

type NativeProps = Omit<VaultPasswordFieldProps, "onEdit" | "onSubmit" | "onEscape"> & {
  onEdit?: (e: NativeSyntheticEvent<{ length: number }>) => void;
  onSubmit?: () => void;
  onEscape?: () => void;
};

let Native: React.ComponentType<NativeProps> | undefined;
const native = () => (Native ??= requireNativeViewManager<NativeProps>("ArdiaVaultPasswordField"));

export function VaultPasswordField({ onEdit, ...props }: VaultPasswordFieldProps) {
  const View = native();
  return <View {...props} onEdit={onEdit ? (e) => onEdit(e.nativeEvent.length) : undefined} />;
}
