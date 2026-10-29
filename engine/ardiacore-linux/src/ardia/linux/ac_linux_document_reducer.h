#ifndef ARDIA_LINUX_AC_LINUX_DOCUMENT_REDUCER_H_
#define ARDIA_LINUX_AC_LINUX_DOCUMENT_REDUCER_H_

#include <optional>
#include <string>

#include "base/values.h"

namespace ardia {

inline constexpr int kLinuxLiveMaxGeneration = 2147483000;
inline constexpr size_t kLinuxLiveMaxDismissedNow = 50;
inline constexpr size_t kLinuxLiveMaxOccurrence = 1024;
inline constexpr int kLinuxLiveDefaultCountdownLead = 60;
inline constexpr int kLinuxLiveMaxCountdownLead = 1440;
bool AdvanceLinuxLiveGeneration(base::DictValue& generations, std::string_view id, int floor = 0);
bool ValidLinuxLiveOperations(const base::ListValue& operations);
std::optional<base::DictValue> NormalizeLinuxLive(const base::DictValue& payload);
std::string ApplyLinuxLiveOperations(base::DictValue& envelope,
                                    const base::ListValue& operations,
                                    const std::string& client,
                                    int observed_revision);
bool ValidLinuxLiveEnvelope(const base::DictValue& envelope);
int LinuxDocumentInteger(const base::DictValue& value, std::string_view key,
                         int fallback = -1);

}

#endif
