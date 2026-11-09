#import <Foundation/Foundation.h>

enum class ArdiaTabPhase { Waiting, Creating, Attached, Closing };

struct ArdiaTabLifecycle {
  ArdiaTabPhase phase{ArdiaTabPhase::Waiting};
  NSUInteger createEpoch{};
  NSString *pendingURL;
  BOOL pendingUserInitiated{};
  NSString *creatingURL;
  CFTimeInterval creatingAt{};
  NSString *transferredURL;
  BOOL handingOff{};
  BOOL moving{};
  BOOL offerClosed{};
  BOOL launchCloseSent{};

  bool closed() const { return phase == ArdiaTabPhase::Closing; }

  bool canCreate() const { return phase == ArdiaTabPhase::Waiting; }

  NSUInteger beginCreating() {
    phase = ArdiaTabPhase::Creating;
    return ++createEpoch;
  }

  bool isCurrent(NSUInteger epoch) const { return epoch == createEpoch && !closed(); }

  void resumeCreating() {
    if (phase == ArdiaTabPhase::Waiting) phase = ArdiaTabPhase::Creating;
  }

  void leaveCreating() {
    if (phase == ArdiaTabPhase::Creating) phase = ArdiaTabPhase::Waiting;
  }

  bool canAttach(bool hasTab) const { return !closed() && !hasTab; }

  void attached() { phase = ArdiaTabPhase::Attached; }

  void detached() {
    if (phase == ArdiaTabPhase::Attached) phase = ArdiaTabPhase::Waiting;
  }

  void handOff() { createEpoch++; }

  void close() {
    createEpoch++;
    phase = ArdiaTabPhase::Closing;
  }
};
