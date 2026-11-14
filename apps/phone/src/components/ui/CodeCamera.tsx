import { ScanView, type ScanError } from "@ardia/phone-native";
import { StyleSheet } from "react-native";

type Props = { active: boolean; onCode: (text: string) => void; onRejected: () => void; onError: (error: ScanError) => void };

export function CodeCamera({ active, onCode, onRejected, onError }: Props) {
  return <ScanView style={StyleSheet.absoluteFill} active={active} onCode={onCode} onRejected={onRejected} onError={onError} />;
}
