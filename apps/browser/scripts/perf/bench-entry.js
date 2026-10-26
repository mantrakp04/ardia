import "./bench-offline";
import "../../index";
import { answerWithSkew, nativeApiSkew } from "../../src/platform/nativeApi";

if (nativeApiSkew) answerWithSkew(nativeApiSkew, "bench-cmd.js", "bench-result.json");
else require("./bench-channel");
