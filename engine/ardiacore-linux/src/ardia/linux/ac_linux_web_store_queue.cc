#include "ardia/linux/ac_linux_web_store_queue.h"

#include <algorithm>
#include <utility>

namespace ardiacore {

bool LinuxWebStoreExtensionId(std::string_view id) {
  return id.size() == 32 && std::all_of(id.begin(), id.end(), [](char c) { return c >= 'a' && c <= 'p'; });
}

std::optional<uint64_t> LinuxWebStoreQueue::Add(std::string extension_id) {
  if (!LinuxWebStoreExtensionId(extension_id) || entries_.size() >= kLinuxWebStoreRequestsMax) return std::nullopt;
  entries_.push_back({++next_, std::move(extension_id), std::nullopt});
  return next_;
}

std::optional<std::string> LinuxWebStoreQueue::Claim(double now) {
  for (auto& entry : entries_) {
    if (entry.claimed_at) continue;
    entry.claimed_at = now;
    return entry.extension_id;
  }
  return std::nullopt;
}

std::vector<uint64_t> LinuxWebStoreQueue::Uninstalled(std::string_view extension_id) {
  std::vector<uint64_t> ids;
  std::erase_if(entries_, [&](const Entry& entry) {
    if (entry.extension_id != extension_id) return false;
    ids.push_back(entry.id);
    return true;
  });
  return ids;
}

std::vector<uint64_t> LinuxWebStoreQueue::Expired(double now) {
  std::vector<uint64_t> ids;
  std::erase_if(entries_, [&](const Entry& entry) {
    if (!entry.claimed_at || now < *entry.claimed_at + kLinuxWebStoreClaimSeconds) return false;
    ids.push_back(entry.id);
    return true;
  });
  return ids;
}

std::optional<double> LinuxWebStoreQueue::NextExpiry() const {
  std::optional<double> next;
  for (const auto& entry : entries_) {
    if (!entry.claimed_at) continue;
    const double at = *entry.claimed_at + kLinuxWebStoreClaimSeconds;
    if (!next || at < *next) next = at;
  }
  return next;
}

bool LinuxWebStoreQueue::HasClaimed() const {
  return std::any_of(entries_.begin(), entries_.end(), [](const Entry& entry) { return entry.claimed_at.has_value(); });
}

void LinuxWebStoreQueue::Renew(double now) {
  for (auto& entry : entries_) {
    if (entry.claimed_at) entry.claimed_at = now;
  }
}

std::vector<uint64_t> LinuxWebStoreQueue::Clear() {
  std::vector<uint64_t> ids;
  for (const auto& entry : entries_) ids.push_back(entry.id);
  entries_.clear();
  return ids;
}

void LinuxWebStoreQueue::Forget(uint64_t id) {
  std::erase_if(entries_, [id](const Entry& entry) { return entry.id == id; });
}

}
