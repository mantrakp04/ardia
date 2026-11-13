import type { InlineCompletionNative, InlineWrite } from "@ardia/shell";
import type { WindowsHostModule } from "./nativeModuleTypes";

const NOT_WRITTEN: InlineWrite = 0;
const SHOWN: InlineWrite = 1;

export function windowsInlineCompletion(host: () => Pick<WindowsHostModule, "textComposing"> | null): InlineCompletionNative {
  return {
    async complete() {
      const composing = await host()?.textComposing().catch(() => true);
      return composing === false ? SHOWN : NOT_WRITTEN;
    },
  };
}
