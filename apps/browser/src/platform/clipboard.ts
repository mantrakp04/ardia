import { nativeModule } from "@ardia/shell";

const Shell = nativeModule("ArdiaShell");

export const copyText = (text: string) => Shell.copyText(text);
export const readText = () => Shell.readText();
