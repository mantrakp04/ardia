import { acceptsDrag, dragCount, type DropController, type DropPoint } from "../../fileDrop";

const claimed = new WeakSet<Event>();
const EDITABLE = "input, textarea, [contenteditable='true'], [contenteditable='']";

const editable = (target: EventTarget | null) => target instanceof Element && !!target.closest(EDITABLE);
const types = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])];
const forEditable = (e: DragEvent) => editable(e.target) && !types(e).includes("Files");

export function guardDocumentDrops() {
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

export function watchDropArea(element: HTMLElement, controller: DropController, wanted: () => boolean) {
  const point = (e: DragEvent): DropPoint => {
    const rect = element.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const files = (e: DragEvent) => [...(e.dataTransfer?.items ?? [])].filter((item) => item.kind === "file").length;
  const over = (e: DragEvent) => {
    if (claimed.has(e) || forEditable(e)) return controller.leave();
    if (!wanted() || !acceptsDrag(types(e))) return;
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
    if (claimed.has(e) || forEditable(e) || !wanted() || !acceptsDrag(types(e))) return controller.leave();
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
    controller.leave();
    element.removeEventListener("dragenter", over);
    element.removeEventListener("dragover", over);
    element.removeEventListener("dragleave", leave);
    element.removeEventListener("drop", drop);
  };
}
