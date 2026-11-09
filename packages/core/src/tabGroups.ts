export const TAB_GROUP_COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"] as const;

export type TabGroupColor = (typeof TAB_GROUP_COLORS)[number];
