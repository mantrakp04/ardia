#ifndef ARDIA_LINUX_AC_LINUX_CLOSE_H_
#define ARDIA_LINUX_AC_LINUX_CLOSE_H_

#include <cstdint>
#include <limits>
#include <optional>
#include <string>

namespace ardia {

class LinuxClose {
 public:
  struct Identity {
    std::string renderer;
    std::string close;
    bool operator==(const Identity&) const = default;
  };
  enum class Phase { kIdle, kRequested, kDraining, kSealing, kSealed, kHandedOff,
                     kTeardown, kDestroying, kCancelling, kCancelled };

  std::optional<Identity> Request(uint64_t renderer) {
    if (phase_ != Phase::kIdle && phase_ != Phase::kCancelled)
      return identity_;
    if (!renderer || generation_ == std::numeric_limits<uint64_t>::max())
      return std::nullopt;
    identity_ = {std::to_string(renderer), std::to_string(++generation_)};
    phase_ = Phase::kRequested;
    watermark_.reset();
    return identity_;
  }
  bool Matches(const Identity& identity, uint64_t renderer) const {
    return IsCurrent(identity) &&
           identity.renderer == std::to_string(renderer);
  }
  bool IsCurrent(const Identity& identity) const {
    return phase_ != Phase::kIdle && identity_ == identity;
  }
  bool BeginDrain(const Identity& identity, uint64_t renderer) {
    if (!Matches(identity, renderer)) return false;
    if (phase_ == Phase::kRequested) phase_ = Phase::kDraining;
    return phase_ == Phase::kDraining || phase_ == Phase::kSealing || CanClose();
  }
  bool BeginSeal(const Identity& identity, uint64_t renderer, int watermark) {
    if (!Matches(identity, renderer) || watermark < 0) return false;
    if (phase_ == Phase::kSealing || CanClose())
      return watermark_ == watermark;
    if (phase_ != Phase::kDraining) return false;
    phase_ = Phase::kSealing;
    watermark_ = watermark;
    return true;
  }
  bool Sealed(const Identity& identity, uint64_t renderer) {
    if (!Matches(identity, renderer) || phase_ != Phase::kSealing) return false;
    phase_ = Phase::kSealed;
    return true;
  }
  bool HandOff(const Identity& identity, uint64_t renderer) {
    if (!Matches(identity, renderer) || !CanClose()) return false;
    if (phase_ == Phase::kSealed) phase_ = Phase::kHandedOff;
    return true;
  }
  bool BeginTeardown(const Identity& identity, uint64_t renderer) {
    if (!Matches(identity, renderer) || !CanClose()) return false;
    if (phase_ != Phase::kDestroying) phase_ = Phase::kTeardown;
    return true;
  }
  bool Destroy(const Identity& identity) {
    if (!IsCurrent(identity) || !CanClose()) return false;
    phase_ = Phase::kDestroying;
    return true;
  }
  bool HandedOff() const {
    return phase_ == Phase::kHandedOff || Irreversible();
  }
  bool Irreversible() const {
    return phase_ == Phase::kTeardown || phase_ == Phase::kDestroying;
  }
  bool BeginCancel(const Identity& identity, bool chrome_aborted = false) {
    if (!IsCurrent(identity) || Irreversible() || (HandedOff() && !chrome_aborted)) return false;
    if (phase_ == Phase::kCancelled) return true;
    phase_ = Phase::kCancelling;
    return true;
  }
  bool Cancelled(const Identity& identity) {
    if (!IsCurrent(identity) || phase_ != Phase::kCancelling) return false;
    phase_ = Phase::kCancelled;
    return true;
  }
  bool BlocksWrites() const {
    return phase_ == Phase::kSealing || phase_ == Phase::kSealed ||
           HandedOff() || phase_ == Phase::kCancelling;
  }
  bool CanClose() const { return phase_ == Phase::kSealed || HandedOff(); }
  Phase phase() const { return phase_; }
  const Identity& identity() const { return identity_; }
  void Retire() {
    if (HandedOff()) return;
    phase_ = Phase::kIdle;
    watermark_.reset();
  }

 private:
  uint64_t generation_ = 0;
  Identity identity_;
  Phase phase_ = Phase::kIdle;
  std::optional<int> watermark_;
};

}

#endif
