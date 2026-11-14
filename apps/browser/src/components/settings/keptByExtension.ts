export const keptByExtensionNote = (value: boolean | undefined, asked: boolean | null | undefined) =>
  value === undefined || asked == null || asked === value
    ? undefined
    : `An extension keeps this ${value ? "on" : "off"}. Change it in that extension's settings, or turn the extension off in Extensions.`;
