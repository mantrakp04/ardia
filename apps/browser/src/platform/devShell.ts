import * as shellPackage from "@ardia/shell";
import * as app from "./app";
import * as calendar from "./calendar";
import * as cli from "./cli";
import * as clipboard from "./clipboard";
import * as commands from "./commands";
import * as dev from "./dev";
import * as dialogs from "./dialogs";
import * as documents from "./documents";
import * as focus from "./focus";
import * as introMusic from "./introMusic";
import * as keychain from "./keychain";
import * as menus from "./menus";
import * as notifications from "./notifications";
import * as scripting from "./scripting";
import * as share from "./share";
import * as text from "./text";
import * as userScripts from "./userScripts";
import * as windows from "./windows";

export const shell = {
  ...shellPackage,
  ...app,
  ...windows,
  ...focus,
  ...menus,
  ...commands,
  ...dialogs,
  ...documents,
  ...clipboard,
  ...text,
  ...share,
  ...introMusic,
  ...notifications,
  ...scripting,
  ...calendar,
  ...keychain,
  ...cli,
  ...userScripts,
  ...dev,
};
