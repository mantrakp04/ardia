// Copyright 2026 Ardia. Apache-2.0.

#ifndef CHROME_BROWSER_ARDIA_AC_REAUTH_LINUX_H_
#define CHROME_BROWSER_ARDIA_AC_REAUTH_LINUX_H_

#include <string>

#include "base/functional/callback_forward.h"

namespace ardia {

void ProbeReauth(base::OnceCallback<void(bool available, std::string reason)> done);

}

#endif
