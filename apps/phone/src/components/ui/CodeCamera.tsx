import { StyleSheet } from "react-native";

type CameraPackage = typeof import("expo-camera");

export function CodeCamera({ onCode, active }: { onCode: (text: string) => void; active: boolean }) {
  const { CameraView } = require("expo-camera") as CameraPackage;
  return (
    <CameraView
      style={StyleSheet.absoluteFill}
      facing="back"
      active={active}
      barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
      onBarcodeScanned={(result) => onCode(result.data)}
    />
  );
}
