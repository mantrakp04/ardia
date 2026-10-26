import { nativeModule } from "./nativeModules";

export type InlineCompletionNative = {
  complete(tag: number, typed: string, completion: string): Promise<InlineWrite>;
};

const InlineCompletionModule = nativeModule("ArdiaInlineCompletion");

export type InlineWrite = 0 | 1 | 2;

export const completeInline = (tag: number, typed: string, completion: string) =>
  InlineCompletionModule.complete(tag, typed, completion);
