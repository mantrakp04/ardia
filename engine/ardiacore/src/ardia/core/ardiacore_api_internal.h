#ifndef ARDIA_CORE_ARDIACORE_API_INTERNAL_H_
#define ARDIA_CORE_ARDIACORE_API_INTERNAL_H_

#import "ardia/core/public/ArdiaCore.h"

#include <string>

#include "base/functional/callback_forward.h"

class Profile;

namespace ardiacore {

extern id<ArdiaCoreEngineDelegate> __strong g_delegate;
extern ArdiaCoreEngine* __strong g_engine;

NSString* NS(const std::string& s);
NSString* NS(const std::u16string& s);

void WhenProfileGone(Profile* profile, base::OnceClosure done);

}

#endif
