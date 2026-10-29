#ifndef ARDIA_LINUX_AC_LINUX_CALENDAR_SERVICE_H_
#define ARDIA_LINUX_AC_LINUX_CALENDAR_SERVICE_H_

#include <string>
#include <string_view>

#include "base/callback_list.h"
#include "base/files/file_path.h"
#include "base/functional/callback.h"
#include "base/values.h"

namespace ardia {

inline constexpr char kLinuxCalendarConsentDocument[] = "linux-calendar.json";

bool LinuxCalendarInvokes(std::string_view method);
void AppendLinuxCalendarCapabilities(base::ListValue& capabilities);
void LinuxCalendarInvoke(const base::FilePath& documents, const std::string& method, const base::ListValue& values,
                         base::OnceCallback<void(bool, base::Value)> done);
base::CallbackListSubscription WatchLinuxCalendar(base::RepeatingCallback<void(const base::DictValue&)> listener);

}

#endif
