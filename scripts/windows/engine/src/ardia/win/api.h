#ifndef ARDIA_WIN_API_H_
#define ARDIA_WIN_API_H_

#include <string_view>

#include "base/functional/callback.h"
#include "base/values.h"
#include "ardia/win/public/EngineApi.h"

namespace ardia_win {

using Reply = base::OnceCallback<void(base::DictValue)>;

const ArdiaEngineApi* EngineApi();

void WatchEngineEvents();

void Emit(std::string_view topic, base::DictValue payload);

base::DictValue Error(std::string_view message);

}

#endif
