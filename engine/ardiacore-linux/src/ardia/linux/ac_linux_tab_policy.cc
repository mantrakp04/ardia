#include "ardia/linux/ac_linux_tab_policy.h"

#include <algorithm>
#include <cmath>
#include <utility>

namespace ardiacore {

std::optional<std::string> LinuxProtectionReason(const LinuxTabProtection& protection) {
  const std::pair<const std::optional<bool>*, std::string_view> checks[] = {
      {&protection.visible, "visible"},
      {&protection.audible, "playing audio"},
      {&protection.playing, "playing media"},
      {&protection.capturing, "capturing"},
      {&protection.picture_in_picture, "picture in picture"},
      {&protection.pending_prompt, "pending prompt"},
      {&protection.dirty_input, "unsaved input"},
  };
  for (const auto& [value, reason] : checks) {
    if (!value->has_value()) return "unknown " + std::string(reason);
    if (**value) return std::string(reason);
  }
  return std::nullopt;
}

std::optional<LinuxDiscardRequest> ParseLinuxDiscardRequest(const base::ListValue& args) {
  if (args.size() > 1) return std::nullopt;
  if (args.size() == 0 || args[0].is_none()) return LinuxDiscardRequest{};
  const base::DictValue* options = args[0].GetIfDict();
  if (!options) return std::nullopt;
  LinuxDiscardRequest request;
  for (const auto [key, value] : *options) {
    if (key != "unload" || !(value.is_bool() || value.is_none())) return std::nullopt;
    request.unload = value.is_bool() && value.GetBool();
  }
  return request;
}

LinuxDiscardDecision DecideLinuxDiscard(bool live, bool discarded, const LinuxDiscardRequest& request,
                                        const LinuxTabProtection& protection) {
  if (request.unload) return LinuxDiscardDecision::kUnsupported;
  if (!live) return LinuxDiscardDecision::kRefused;
  if (discarded) return LinuxDiscardDecision::kAlready;
  if (LinuxProtectionReason(protection)) return LinuxDiscardDecision::kRefused;
  return LinuxDiscardDecision::kDiscard;
}

std::string_view LinuxDiscardOutcome(LinuxDiscardDecision decision, bool discarded_now) {
  switch (decision) {
    case LinuxDiscardDecision::kDiscard: return discarded_now ? "discarded" : "refused";
    case LinuxDiscardDecision::kAlready: return "already";
    case LinuxDiscardDecision::kUnsupported: return "unsupported";
    case LinuxDiscardDecision::kRefused: return "refused";
  }
  return "refused";
}

std::optional<bool> ParseLinuxFrozen(const base::ListValue& args) {
  if (args.size() != 1 || !args[0].is_bool()) return std::nullopt;
  return args[0].GetBool();
}

bool LinuxMayFreeze(const LinuxTabProtection& protection) {
  return !LinuxProtectionReason(protection);
}

std::optional<bool> LinuxUnsavedInput(std::optional<bool> before_unload,
                                      std::optional<bool> form_interaction,
                                      std::optional<bool> user_edits) {
  if (before_unload.value_or(false) || form_interaction.value_or(false) || user_edits.value_or(false))
    return true;
  if (!before_unload || !form_interaction || !user_edits) return std::nullopt;
  return false;
}

std::optional<bool> LinuxEditedInput(std::optional<bool> form_interaction, std::optional<bool> user_edits) {
  if (form_interaction.value_or(false) || user_edits.value_or(false)) return true;
  if (!form_interaction || !user_edits) return std::nullopt;
  return false;
}

std::string_view LinuxMemoryPressure(uint64_t physical, uint64_t available) {
  if (!physical || available > physical) return "normal";
  const double free = static_cast<double>(available) / static_cast<double>(physical);
  if (free < 0.05) return "critical";
  if (free < 0.10) return "warning";
  return "normal";
}

base::DictValue LinuxSystemState(const LinuxPowerSample& sample) {
  const bool battery = sample.upower && sample.device_type == kLinuxUPowerBattery &&
                       sample.is_present.value_or(false) && sample.percentage &&
                       std::isfinite(*sample.percentage);
  base::Value level = battery
      ? base::Value(std::round(std::clamp(*sample.percentage, 0.0, 100.0)) / 100.0) : base::Value();
  return base::DictValue()
      .Set("onBattery", sample.upower && sample.on_battery.value_or(false))
      .Set("batteryLevel", std::move(level))
      .Set("lowPowerMode", sample.power_profile.value_or("") == "power-saver")
      .Set("memoryPressure", sample.memory_level.empty()
                                 ? std::string(LinuxMemoryPressure(sample.physical_memory, sample.available_memory))
                                 : sample.memory_level)
      .Set("memorySignal", sample.memory_signal.empty() ? std::string("meminfo") : sample.memory_signal)
      .Set("physicalMemory", static_cast<double>(sample.physical_memory))
      .Set("power", sample.upower ? "upower" : "unavailable")
      .Set("battery", !sample.upower ? "unavailable" : battery ? "present" : "absent");
}

void LinuxPowerTracker::SetPower(const LinuxPowerSample& power) {
  const uint64_t physical = sample_.physical_memory;
  const uint64_t available = sample_.available_memory;
  std::string level = std::move(sample_.memory_level);
  std::string signal = std::move(sample_.memory_signal);
  sample_ = power;
  sample_.physical_memory = physical;
  sample_.available_memory = available;
  sample_.memory_level = std::move(level);
  sample_.memory_signal = std::move(signal);
}

void LinuxPowerTracker::SetMemory(uint64_t physical, uint64_t available, std::string level, std::string signal) {
  sample_.physical_memory = physical;
  sample_.available_memory = available;
  sample_.memory_level = std::move(level);
  sample_.memory_signal = std::move(signal);
  memory_ready_ = true;
}

std::optional<base::DictValue> LinuxPowerTracker::Take() {
  if (!Ready()) return std::nullopt;
  base::DictValue state = LinuxSystemState(sample_);
  if (state_ && *state_ == state) return std::nullopt;
  state_ = state.Clone();
  return state;
}

}
