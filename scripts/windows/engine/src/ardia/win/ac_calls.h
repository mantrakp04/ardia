#ifndef ARDIA_WIN_AC_CALLS_H_
#define ARDIA_WIN_AC_CALLS_H_

#include <string_view>

#include "chrome/browser/ardia/public/ac_engine.h"

namespace ardia_win {

ac_engine_call_t FindEngineCall(std::string_view name);

}

#endif
