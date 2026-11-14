import { StyleSheet } from "react-native";

type CameraPackage = typeof import("expo-camera");

export function CodeCamera({ onCode }: { onCode: (text: string) => void }) {
  const { CameraView } = require("expo-camera") as CameraPackage;
  return (
    <CameraView
      style={StyleSheet.absoluteFill}
      facing="back"
      barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
      onBarcodeScanned={(result) => onCode(result.data)}
    />
  );
}
