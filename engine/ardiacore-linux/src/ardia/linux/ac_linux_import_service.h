#ifndef ARDIA_LINUX_AC_LINUX_IMPORT_SERVICE_H_
#define ARDIA_LINUX_AC_LINUX_IMPORT_SERVICE_H_

#include <string>
#include <string_view>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/values.h"

namespace content {
class WebContents;
}

namespace ardia {

struct LinuxImportRequester {
  std::string owner;
  raw_ptr<content::WebContents> contents = nullptr;
  base::RepeatingCallback<void(base::Value)> emit;
};

bool LinuxImportHandles(std::string_view method);
void LinuxImportInvoke(LinuxImportRequester requester, const std::string& method, const base::ListValue& values,
                       base::OnceCallback<void(bool, base::Value)> done);
void LinuxImportWindowClosed(std::string_view owner);

}

#endif
