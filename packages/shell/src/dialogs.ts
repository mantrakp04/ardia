import { Shell } from "./shellNative";

export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmTitle?: string;
  cancelTitle?: string;
  destructive?: boolean;
  suppression?: string;
  windowId?: string;
};

export type PromptOptions = {
  title: string;
  message?: string;
  value?: string;
  placeholder?: string;
  confirmTitle?: string;
  windowId?: string;
};

export const pickFiles = () => Shell.pickFiles();
export const pickFolder = (current: string | null, prompt: string | null = null) => Shell.pickFolder(current, prompt);

export const confirm = (options: ConfirmOptions) => Shell.confirm(options);
export const prompt = (options: PromptOptions) => Shell.prompt(options);
