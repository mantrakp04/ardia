#ifndef ARDIA_LINUX_AC_LINUX_TELEMETRY_H_
#define ARDIA_LINUX_AC_LINUX_TELEMETRY_H_

#include <memory>
#include <string>
#include <vector>

#include "base/functional/callback.h"

namespace ardia::linux_telemetry {

using PostReply = base::OnceCallback<void(int status)>;

class TelemetryPost;

class TelemetryClient {
 public:
  TelemetryClient();
  TelemetryClient(const TelemetryClient&) = delete;
  TelemetryClient& operator=(const TelemetryClient&) = delete;
  ~TelemetryClient();

  void Post(std::string body, const std::string& ingest_key, PostReply reply);

 private:
  friend class TelemetryPost;
  void Finish(TelemetryPost* post, int status);

  std::vector<std::unique_ptr<TelemetryPost>> posts_;
};

}

#endif
