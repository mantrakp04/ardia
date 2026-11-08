import { forwardRef, useEffect, useRef, type Ref } from "react";
import { View } from "react-native";
import type { FileDropAreaProps } from "@ardia-real/shell";
import { ardiaHost, hostSupports, invokeHost } from "../../host";
import { createDropController } from "../../fileDrop";
import { FILE_DROP } from "../../fileCapabilities";
import { guardDocumentDrops, watchDropArea } from "./dropArea";

const claimFiles = (names: string[]) =>
  ardiaHost && hostSupports(FILE_DROP) ? invokeHost<unknown>(FILE_DROP, { args: [names] }) : Promise.resolve([]);

function assign<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

export const FileDropArea = forwardRef<View, FileDropAreaProps>(function FileDropArea({ onDropUpdate, enabled = true, accepts: _accepts, ...props }, ref) {
  const node = useRef<HTMLElement | null>(null);
  const latest = useRef(onDropUpdate);
  latest.current = onDropUpdate;
  const accepting = useRef(enabled);
  accepting.current = enabled;

  useEffect(() => {
    guardDocumentDrops();
    const element = node.current;
    if (!element) return;
    return watchDropArea(element, createDropController((update) => latest.current?.(update), claimFiles), () => accepting.current && !!latest.current);
  }, []);

  return (
    <View
      {...props}
      ref={(value: View | null) => {
        node.current = value as unknown as HTMLElement | null;
        assign(ref, value);
      }}
    />
  );
});
