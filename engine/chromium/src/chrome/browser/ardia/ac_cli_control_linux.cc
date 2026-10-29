#include "chrome/browser/ardia/ac_engine.h"

AC_ARGS_CALL(ac_cli_control) {
  call.TakeReply().Error("CLI token authentication is unavailable on Linux");
}
