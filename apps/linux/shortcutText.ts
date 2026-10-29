const KEY_NAMES: [string, string][] = [["⌘", "Ctrl"], ["⌃", "Super"], ["⌥", "Alt"], ["⇧", "Shift"]];
const MODIFIER_RUN = /[⌘⌥⇧⌃]+(?=-[a-z])/g;
const MODIFIER = /[⌘⌥⇧⌃]/;

export const hasMacModifiers = (code: string) => MODIFIER.test(code);

export function linuxShortcutText(code: string): string {
  const pointerModifiers = code.replace(MODIFIER_RUN, (run) => KEY_NAMES.filter(([symbol]) => run.includes(symbol)).map(([, name]) => name).join("+"));
  return KEY_NAMES.reduce((text, [symbol, name]) => text.replaceAll(symbol, `${name}+`), pointerModifiers);
}
