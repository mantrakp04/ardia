#ifndef ARDIA_WIN_TAB_CALLS_H_
#define ARDIA_WIN_TAB_CALLS_H_

#include <string>

#include "ardia/win/api.h"
#include "base/values.h"

namespace content {
class WebContents;
}

namespace ardia_win {

bool CallTabMethod(content::WebContents* contents,
                   const std::string& method,
                   const base::DictValue& args,
                   Reply& reply);

}

#endif
