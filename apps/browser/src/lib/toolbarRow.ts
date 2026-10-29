export type ToolbarRow = {
  height: number;
  center: number;
  button: number;
  buttonRadius: number;
  field: number;
  fieldRadius: number;
  fieldButton: number;
  fieldButtonRadius: number;
  extensionButton: number;
};

export const TOOLBAR_ROWS: Record<"regular" | "compact", ToolbarRow> = {
  regular: { height: 41, center: 21.2, button: 30, buttonRadius: 7, field: 30, fieldRadius: 8, fieldButton: 24, fieldButtonRadius: 6, extensionButton: 28 },
  compact: { height: 28, center: 14, button: 22, buttonRadius: 5, field: 22, fieldRadius: 6, fieldButton: 18, fieldButtonRadius: 4, extensionButton: 22 },
};

export const toolbarRowOf = (compact: boolean): ToolbarRow => (compact ? TOOLBAR_ROWS.compact : TOOLBAR_ROWS.regular);

export const urlFieldOf = (row: ToolbarRow) => ({ top: row.center - row.field / 2, height: row.field });

export const compactLift = (row: ToolbarRow) => Math.round((TOOLBAR_ROWS.regular.center - row.center) * 2) / 2;
