import { forwardRef, useEffect, useRef, type Ref } from "react";
import { View } from "react-native";
import type { FileDropAreaProps } from "@ardia-real/shell";
import { ardiaHost, hostSupports, invokeHost } from "../../host";
import { acceptsDrag, createDropController, dragCount, type DropPoint } from "../../fileDrop";
import { FILE_DROP } from "../../fileCapabilities";

const claimed = new WeakSet<Event>();
const EDITABLE = "input, textarea, [contenteditable='true'], [contenteditable='']";

const editable = (target: EventTarget | null) => target instanceof Element && !!target.closest(EDITABLE);

function guardDocumentDrops() {
  if (typeof document === "undefined" || (globalThis as { __ardiaDropGuard?: boolean }).__ardiaDropGuard) return;
  (globalThis as { __ardiaDropGuard?: boolean }).__ardiaDropGuard = true;
  document.addEventListener("dragover", (e) => {
    if (claimed.has(e) || editable(e.target)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
  });
  document.addEventListener("drop", (e) => {
    if (!claimed.has(e) && !editable(e.target)) e.preventDefault();
  });
}

const claimFiles = (names: string[]) =>
  ardiaHost && hostSupports(FILE_DROP) ? invokeHost<unknown>(FILE_DROP, { args: [names] }) : Promise.resolve([]);

function assign<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

export const FileDropArea = forwardRef<View, FileDropAreaProps>(function FileDropArea({ onDropUpdate, ...props }, ref) {
  const node = useRef<HTMLElement | null>(null);
  const latest = useRef(onDropUpdate);
  latest.current = onDropUpdate;

  useEffect(() => {
    guardDocumentDrops();
    const element = node.current;
    if (!element) return;
    const controller = createDropController((update) => latest.current?.(update), claimFiles);
    const point = (e: DragEvent): DropPoint => {
      const rect = element.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const types = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])];
    const files = (e: DragEvent) => [...(e.dataTransfer?.items ?? [])].filter((item) => item.kind === "file").length;
    const over = (e: DragEvent) => {
      if (claimed.has(e)) return controller.leave();
      if (!latest.current || !acceptsDrag(types(e))) return;
      claimed.add(e);
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      controller.over(point(e), dragCount(types(e), files(e)));
    };
    const leave = (e: DragEvent) => {
      const next = e.relatedTarget;
      if (next instanceof Node && element.contains(next)) return;
      controller.leave();
    };
    const drop = (e: DragEvent) => {
      if (claimed.has(e) || !latest.current || !acceptsDrag(types(e))) return controller.leave();
      claimed.add(e);
      e.preventDefault();
      const transfer = e.dataTransfer;
      void controller.drop(point(e), {
        uriList: transfer?.getData("text/uri-list") ?? "",
        text: transfer?.getData("text/plain") ?? "",
        fileNames: [...(transfer?.files ?? [])].map((file) => file.name),
      });
    };
    element.addEventListener("dragenter", over);
    element.addEventListener("dragover", over);
    element.addEventListener("dragleave", leave);
    element.addEventListener("drop", drop);
    return () => {
      element.removeEventListener("dragenter", over);
      element.removeEventListener("dragover", over);
      element.removeEventListener("dragleave", leave);
      element.removeEventListener("drop", drop);
    };
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
