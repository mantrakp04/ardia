import "./bench-offline";
import "../../index";
import { requireNativeModule, requireOptionalNativeModule } from "expo-modules-core";
import { nativeApiSkew } from "../../src/platform/nativeApi";

function answerBenchWithSkew(message) {
  const documents = requireOptionalNativeModule("ArdiaDocuments") ?? requireNativeModule("ArdiaShell");
  const idOf = (source) => source?.match(/^\/\/ *(\S+)/)?.[1];
  let lastId = idOf(documents.readDocument("bench-cmd.js")) ?? "";
  setInterval(() => {
    const id = idOf(documents.readDocument("bench-cmd.js"));
    if (!id || id === lastId) return;
    lastId = id;
    documents.writeDocument("bench-result.json", JSON.stringify({ id, error: message }));
  }, 250);
}

if (nativeApiSkew) answerBenchWithSkew(nativeApiSkew);
else require("./bench-channel");
