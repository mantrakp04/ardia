import { springs } from "../ui/motion";
import { ink } from "../ui/tokens";

export const UNREAD_FILL = "#EB4648";
export const UNREAD_INK = ink.white;

export const UNREAD_COUNT_BOX = { top: -5, right: -6, width: 32 } as const;
export const UNREAD_DOT = { size: 8, top: -2, right: -2 } as const;

export const unreadMotion = { show: springs.bouncy, hide: springs.snappy, hiddenScale: 0.5 } as const;
