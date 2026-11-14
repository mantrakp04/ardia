import { useContext } from "react";
import { Symbol as NativeSymbol, type SymbolProps } from "@ardia/shell";
import { iconName } from "../../lib/activeLook";
import { ThemeContext } from "./theme";

export type { SymbolProps };

export function Symbol(props: SymbolProps) {
  useContext(ThemeContext);
  return <NativeSymbol {...props} name={iconName(props.name)} />;
}
