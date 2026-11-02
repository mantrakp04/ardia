import { createContext, useContext } from "react";
import { TOOLBAR_ROWS, type ToolbarRow } from "../../lib/toolbarRow";

export const ToolbarRowContext = createContext<ToolbarRow>(TOOLBAR_ROWS.regular);

export const useToolbarRowContext = () => useContext(ToolbarRowContext);
