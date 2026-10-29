import { nativeModule } from "@ardia/shell";

export { completeInline, translation } from "@ardia/shell";

export const startDictation = () => nativeModule("ArdiaShell").startDictation();
