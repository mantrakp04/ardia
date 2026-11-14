import { requireNativeModule } from "expo-modules-core";
import type { DialogPagesNative } from "@ardia/shell";

export const dialogPages = requireNativeModule<DialogPagesNative>("ArdiaDialogPages");
