import { browserDatabase } from "../store/database";
import { createHistoryLog, type HistoryLog } from "./historyLog";

let log: HistoryLog | null = null;

export const history = (): HistoryLog => (log ??= createHistoryLog(browserDatabase()));
