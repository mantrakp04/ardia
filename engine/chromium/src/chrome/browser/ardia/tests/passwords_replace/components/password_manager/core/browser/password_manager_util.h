#pragma once
#include <string>
#include "url/gurl.h"
namespace password_manager_util {
inline std::string GetSignonRealm(const GURL& url) { return url.origin(); }
}
