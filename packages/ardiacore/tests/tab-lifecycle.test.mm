#import "../ios/ArdiaTabLifecycle.h"

#include <cstdio>

static int failures = 0;
#define CHECK(cond)                                                \
  do {                                                             \
    if (!(cond)) {                                                 \
      std::printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);  \
      failures++;                                                  \
    }                                                              \
  } while (0)

int main() {
  @autoreleasepool {
    {
      ArdiaTabLifecycle life;
      CHECK(life.canCreate());
      const NSUInteger epoch = life.beginCreating();
      CHECK(!life.canCreate());
      life.close();
      CHECK(!life.isCurrent(epoch));
      CHECK(life.closed() && !life.canCreate() && !life.canAttach(false));
      life.leaveCreating();
      life.resumeCreating();
      CHECK(life.closed());
    }
    {
      ArdiaTabLifecycle life;
      life.beginCreating();
      life.attached();
      life.close();
      life.detached();
      CHECK(life.closed() && !life.canCreate());
    }
    {
      ArdiaTabLifecycle life;
      life.close();
      CHECK(life.closed() && !life.canCreate() && !life.canAttach(false));
    }
    {
      ArdiaTabLifecycle life;
      life.beginCreating();
      life.attached();
      const NSUInteger before = life.createEpoch;
      life.handOff();
      life.detached();
      CHECK(life.phase == ArdiaTabPhase::Waiting && life.canCreate() && life.createEpoch > before);
    }
    {
      ArdiaTabLifecycle life;
      const NSUInteger epoch = life.beginCreating();
      CHECK(life.isCurrent(epoch));
      life.leaveCreating();
      CHECK(life.phase == ArdiaTabPhase::Waiting && life.canCreate());
      const NSUInteger next = life.beginCreating();
      CHECK(next > epoch && !life.isCurrent(epoch) && life.isCurrent(next));
    }
    {
      ArdiaTabLifecycle life;
      life.beginCreating();
      life.attached();
      CHECK(!life.canAttach(true));
      CHECK(life.canAttach(false));
    }
  }
  if (failures) return 1;
  std::printf("tab-lifecycle: ok\n");
  return 0;
}
