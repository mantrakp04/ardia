const SYMBOL_PREFIX = "symbol:";

export const symbolIcon = (name: string) => SYMBOL_PREFIX + name;

export const iconSymbol = (icon: string | null | undefined): string | null => (icon?.startsWith(SYMBOL_PREFIX) ? icon.slice(SYMBOL_PREFIX.length) : null);
