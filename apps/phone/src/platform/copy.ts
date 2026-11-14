import { Platform } from "react-native";
import { selectCopy } from "../lib/platformCopy";

selectCopy(Platform.OS);

export const platformOS = Platform.OS;
