#ifndef ARDIA_LINUX_AC_LINUX_CALENDAR_EDS_H_
#define ARDIA_LINUX_AC_LINUX_CALENDAR_EDS_H_

#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace ardia::linux_calendar {

inline constexpr int kCallTimeoutMs = 10000;
inline constexpr int kOpenTimeoutMs = 30000;
inline constexpr size_t kMaxObjectsPerCalendar = 20000;
inline constexpr size_t kMaxObjectBytes = 1 << 20;
inline constexpr size_t kMaxTimezones = 64;
inline constexpr size_t kMaxReplyBytes = 32 << 20;
inline constexpr int kRequestBudgetMs = 90000;
inline constexpr int kTimeoutCooldownMs = 120000;

enum class EdsStatus { kOk, kUnavailable, kDenied, kFailed };
std::string_view EdsStatusName(EdsStatus status);

struct EdsResult {
  EdsStatus status = EdsStatus::kOk;
  std::string message;
  bool timed_out = false;
  bool ok() const { return status == EdsStatus::kOk; }
};

using KeyFile = std::map<std::string, std::map<std::string, std::string>>;
KeyFile ParseKeyFile(std::string_view text);

struct EdsSource {
  std::string uid;
  KeyFile data;
};

struct EdsCalendarObjects {
  EdsResult result;
  std::vector<std::string> objects;
  bool truncated = false;
};

enum class EdsChange { kObjects, kSources, kService };

std::optional<std::string> EdsTimeRangeQuery(int64_t start_ms, int64_t end_ms);
bool IsCalendarSource(const EdsSource& source);

class EdsClient {
 public:
  using ChangeListener = std::function<void(EdsChange)>;
  virtual ~EdsClient() = default;
  virtual EdsResult Probe() = 0;
  virtual EdsResult Sources(std::vector<EdsSource>* sources) = 0;
  virtual EdsCalendarObjects Objects(const std::string& uid, int64_t start_ms, int64_t end_ms, int budget_ms,
                                     size_t max_bytes) = 0;
  virtual EdsResult Timezone(const std::string& uid, const std::string& tzid, std::string* ics) = 0;
  virtual void CloseCalendars() = 0;
};

std::unique_ptr<EdsClient> SessionEdsClient(EdsClient::ChangeListener listener);
EdsResult ProbeEds();

}

#endif
