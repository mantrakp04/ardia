#include "chrome/browser/ardia/ac_engine.h"

AC_ARGS_CALL(ac_cli_control) {
  call.TakeReply().Error("the ardia command is not on Windows yet");
}
