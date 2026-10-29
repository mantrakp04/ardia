#ifndef ARDIA_LINUX_AC_LINUX_TAB_POLICY_H_
#define ARDIA_LINUX_AC_LINUX_TAB_POLICY_H_

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

#include "base/values.h"

namespace ardiacore {

struct LinuxTabProtection {
  std::optional<bool> visible;
  std::optional<bool> audible;
  std::optional<bool> playing;
  std::optional<bool> capturing;
  std::optional<bool> picture_in_picture;
  std::optional<bool> pending_prompt;
  std::optional<bool> dirty_input;
};

std::optional<std::string> LinuxProtectionReason(const LinuxTabProtection& protection);

enum class LinuxDiscardDecision { kDiscard, kAlready, kRefused, kUnsupported };

struct LinuxDiscardRequest {
  bool unload = false;
};

std::optional<LinuxDiscardRequest> ParseLinuxDiscardRequest(const base::ListValue& args);
LinuxDiscardDecision DecideLinuxDiscard(bool live, bool discarded, const LinuxDiscardRequest& request,
                                        const LinuxTabProtection& protection);
std::string_view LinuxDiscardOutcome(LinuxDiscardDecision decision, bool discarded_now);

std::optional<bool> ParseLinuxFrozen(const base::ListValue& args);
bool LinuxMayFreeze(const LinuxTabProtection& protection);

std::optional<bool> LinuxUnsavedInput(std::optional<bool> before_unload,
                                      std::optional<bool> form_interaction,
                                      std::optional<bool> user_edits);
std::optional<bool> LinuxEditedInput(std::optional<bool> form_interaction, std::optional<bool> user_edits);

struct LinuxPowerSample {
  bool upower = false;
  std::optional<bool> on_battery;
  std::optional<uint32_t> device_type;
  std::optional<bool> is_present;
  std::optional<double> percentage;
  std::optional<std::string> power_profile;
  uint64_t physical_memory = 0;
  uint64_t available_memory = 0;
  std::string memory_level;
  std::string memory_signal;
};

inline constexpr uint32_t kLinuxUPowerBattery = 2;

std::string_view LinuxMemoryPressure(uint64_t physical, uint64_t available);
base::DictValue LinuxSystemState(const LinuxPowerSample& sample);

class LinuxPowerTracker {
 public:
  void SetPower(const LinuxPowerSample& power);
  void PowerAnswered() { power_ready_ = true; }
  void SetMemory(uint64_t physical, uint64_t available, std::string level = {}, std::string signal = {});
  bool Ready() const { return power_ready_ && memory_ready_; }
  std::optional<base::DictValue> Take();
  const std::optional<base::DictValue>& state() const { return state_; }

 private:
  LinuxPowerSample sample_;
  bool power_ready_ = false;
  bool memory_ready_ = false;
  std::optional<base::DictValue> state_;
};

}

#endif
