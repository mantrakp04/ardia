import { scaleTextMetrics } from "../../lib/interfaceMetrics";
import { forwardRef, type ComponentProps } from "react";
import { StyleSheet, Text as NativeText, TextInput as NativeInput, type TextProps, type TextInputProps, type TextStyle } from "react-native";
import { FadeLabel as NativeFadeLabel, Symbol as NativeSymbol } from "@ardia/shell";
import { font } from "./tokens";
import { useInterfaceMetrics } from "./interfaceSize";
function textStyle(style: TextProps["style"], factor: number): TextStyle {
  const resolved = StyleSheet.flatten(style) ?? {};
  return scaleTextMetrics({ ...resolved, fontSize: resolved.fontSize ?? font.body.fontSize }, factor);
}
export const RawText = forwardRef<NativeText, TextProps>(function RawText({ style, ...props }, ref) {
  return <NativeText {...props} ref={ref} style={textStyle(style, useInterfaceMetrics().factor)} />;
});
export type TextInput = NativeInput;
export const TextInput = forwardRef<NativeInput, TextInputProps>(function TextInput({ style, ...props }, ref) {
  return <NativeInput {...props} ref={ref} style={textStyle(style, useInterfaceMetrics().factor)} />;
});
export function FadeLabel({ fontSize, fadeWidth, ...props }: ComponentProps<typeof NativeFadeLabel>) {
  const { factor } = useInterfaceMetrics();
  return <NativeFadeLabel {...props} fontSize={fontSize === undefined ? font.body.fontSize * factor : fontSize * factor} fadeWidth={fadeWidth === undefined ? undefined : fadeWidth * factor} />;
}
export function Symbol({ size, ...props }: ComponentProps<typeof NativeSymbol>) {
  const { factor } = useInterfaceMetrics();
  return <NativeSymbol {...props} size={size === undefined ? undefined : size * factor} />;
}
