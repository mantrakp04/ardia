import { nativeModule, type ConfirmOptions, type PromptOptions } from "@ardia/shell";

const Dialogs = nativeModule("ArdiaDialogs");

export const confirm = (options: ConfirmOptions) => Dialogs.confirm(options);
export const prompt = (options: PromptOptions) => Dialogs.prompt(options);
export const pickFiles = () => Dialogs.pickFiles();
export const pickFolder = (current: string | null, prompt: string | null = null) => Dialogs.pickFolder(current, prompt);
