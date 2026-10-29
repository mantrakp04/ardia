import { symbolIcon } from "../../lib/customIcon";

export const NO_GROUP_ICON = symbolIcon("square.stack.fill");
export const hasOwnGroupIcon = (icon: string | null | undefined): icon is string => !!icon && icon !== NO_GROUP_ICON;
