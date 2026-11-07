#ifndef ARDIA_LINUX_AC_LINUX_SITE_CONTROLS_H_
#define ARDIA_LINUX_AC_LINUX_SITE_CONTROLS_H_

#include <cstdint>
#include <deque>
#include <optional>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

#include "base/values.h"

namespace linux_site_controls {

struct Failure {
  std::string code;
  std::string message;
};

enum class ProfileRoute { kApp, kRegistry, kPrivate };

bool Handles(std::string_view name);
bool IsContentBlockerCall(std::string_view name);
std::vector<std::string_view> Capabilities();

std::variant<ProfileRoute, Failure> RouteProfile(std::string_view name, std::string_view requested, bool private_page);

struct ServiceRequest {
  std::string service;
  base::DictValue args;
};

std::variant<ServiceRequest, Failure> PrepareServiceCall(std::string_view name,
                                                         const base::DictValue& args);
std::variant<base::Value, Failure> CompleteServiceCall(std::string_view name,
                                                       const base::Value& reply);

bool ValidOrigin(std::string_view origin);
std::optional<std::string> NormalizeHost(std::string_view host);
bool ValidListId(std::string_view id);

enum class BlockerOp { kState, kSetEnabled, kSetList, kIsAllowed, kSetAllowed, kFailNext, kSettings, kFollow };

inline constexpr size_t kMaxFollowedLists = 512;
inline constexpr size_t kMaxFollowedDirectives = 10000;
inline constexpr size_t kMaxDirectiveBytes = 2048;

struct BlockerSettings {
  std::vector<std::string> lists;
  std::vector<std::string> whitelist;
  bool auto_update = true;
};

std::optional<BlockerSettings> ParseBlockerSettings(const base::Value& value);
base::DictValue BlockerSettingsValue(const BlockerSettings& settings);

struct BlockerRequest {
  BlockerOp op = BlockerOp::kState;
  std::string id;
  std::string host;
  bool flag = false;
  BlockerSettings settings;
};

inline constexpr int64_t kHoldDeadlineMs = 10000;
inline constexpr int kInheritAttempts = 6;

bool HoldsNavigationTo(std::string_view scheme);
bool ShouldHoldNavigations(bool leader, bool new_profile);
bool HoldUntilFirstCopy(bool leader, bool new_profile);
int64_t InheritRetryDelayMs(int attempt);

std::variant<BlockerRequest, Failure> PrepareBlockerCall(std::string_view name,
                                                         const base::DictValue& args);

bool Mutates(BlockerOp op);
std::optional<Failure> PrivateBlockerRefusal(std::string_view name, const base::DictValue& args,
                                             bool private_window);
std::string_view BridgeOpName(BlockerOp op);

std::string Category(std::string_view list_id, std::string_view group);
base::DictValue BlockerState(const base::DictValue& read, std::string_view version);
base::DictValue UnavailableBlockerState(std::string_view version, std::string_view error);
std::variant<base::Value, Failure> CompleteBlockerCall(const BlockerRequest& request,
                                                       const base::Value* value,
                                                       const std::string* error,
                                                       std::string_view version);
bool RetriableBridgeError(std::string_view error);
bool ValidBundledVersion(std::string_view version);

inline constexpr std::string_view kExtensionId = "fajbdaomknpkicfjcpipdmcpoamdmilh";
inline constexpr std::string_view kBridgePage = "ardia-linux-bridge.html";
inline constexpr std::string_view kUnavailableCode = "ERR_CONTENT_BLOCKER_UNAVAILABLE";

std::string SendScript(std::string_view request_literal);
std::string PollScript();

struct PendingCall {
  int ticket = 0;
  BlockerRequest request;
  int64_t deadline_ms = 0;
  int attempts_left = 0;
  bool fail_next = false;
};

base::DictValue BridgeRequest(const PendingCall& call, int64_t now_ms);

struct BridgeReply {
  int ticket = 0;
  std::optional<std::string> error;
  base::Value value;
};

std::optional<BridgeReply> ParseBridgeReply(const base::Value& parsed, int expected_ticket);

class BlockerQueue {
 public:
  enum class Step { kIdle, kOpenPage, kSend, kWait };

  static constexpr int kAttempts = 40;
  static constexpr int64_t kCallMs = 20000;
  static constexpr int64_t kGraceMs = 2000;
  static constexpr int64_t kRetryMs = 250;
  static constexpr int64_t kPageIdleMs = 30000;
  static constexpr size_t kMaxQueued = 64;

  struct Outcome {
    PendingCall call;
    std::optional<std::string> error;
    base::Value value;
    bool retry = false;
    bool reset_page = false;
  };

  std::optional<int> Enqueue(BlockerRequest request, int64_t now_ms);
  void FailNext() { fail_next_ = true; }
  Step Next(int64_t now_ms);
  void PageReady();
  std::optional<Outcome> PageGone(std::string_view reason, int64_t now_ms);
  void Sent();
  std::optional<Outcome> Expired(int64_t now_ms);
  std::optional<Outcome> Answer(BridgeReply reply, int64_t now_ms);
  std::optional<Outcome> Fail(std::string_view error, int64_t now_ms);
  std::vector<PendingCall> Drain();
  bool IdleFor(int64_t now_ms) const;
  const PendingCall* Current() const { return calls_.empty() ? nullptr : &calls_.front(); }
  bool page_ready() const { return page_ready_; }
  bool page_opening() const { return page_opening_; }
  bool in_flight() const { return in_flight_; }
  size_t size() const { return calls_.size(); }

 private:
  Outcome Finish(std::optional<std::string> error, base::Value value, int64_t now_ms);

  std::deque<PendingCall> calls_;
  int next_ticket_ = 0;
  bool page_ready_ = false;
  bool page_opening_ = false;
  bool in_flight_ = false;
  bool fail_next_ = false;
  int64_t retry_at_ms_ = 0;
  int64_t idle_since_ms_ = 0;
};

}

#endif
