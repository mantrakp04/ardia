import { ink, radius } from "../../ui/tokens";

export const SYNC_CODE_SIZE = 176;
export const SYNC_CODE_QUIET = 16;

const FRAME_SIZE = SYNC_CODE_SIZE + SYNC_CODE_QUIET * 2;

export function syncCodeFrame(theme: { groupFill: string; groupBorder: string }, shown: boolean) {
  return {
    width: FRAME_SIZE,
    height: FRAME_SIZE,
    borderRadius: radius.tile,
    borderWidth: 1,
    borderColor: theme.groupBorder,
    backgroundColor: shown ? ink.white : theme.groupFill,
    alignItems: "center",
    justifyContent: "center",
  } as const;
}
