export const SYMBOL_PREFIX = "symbol:";
export const NO_GROUP_ICON = `${SYMBOL_PREFIX}square.stack.fill`;
export const hasOwnGroupIcon = (icon: string | null | undefined): icon is string => !!icon && icon !== NO_GROUP_ICON;
