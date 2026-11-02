#import "../ios/ArdiaTransferLedger.h"

#include <cstdio>
#include <thread>

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
      ArdiaTransferLedger *ledger = [ArdiaTransferLedger new];
      const NSInteger held = [ledger holdForReload:@"t"];
      const NSInteger moved = [ledger prepare:@"t"];
      CHECK(moved != held);
      CHECK(![ledger expireReloadHold:@"t" generation:held]);
      CHECK([ledger isPrepared:@"t"]);
    }
    {
      ArdiaTransferLedger *ledger = [ArdiaTransferLedger new];
      const NSInteger held = [ledger holdForReload:@"t"];
      CHECK([ledger park:@"t"] == held);
      CHECK([ledger expireReloadHold:@"t" generation:held]);
      CHECK(![ledger isPrepared:@"t"]);
      CHECK([ledger retireParked:@"t" generation:held]);
      CHECK(![ledger expireReloadHold:@"t" generation:held]);
    }
    {
      ArdiaTransferLedger *ledger = [ArdiaTransferLedger new];
      const NSInteger held = [ledger holdForReload:@"t"];
      CHECK([ledger expireReloadHold:@"t" generation:held]);
      const NSInteger moved = [ledger prepare:@"t"];
      CHECK([ledger park:@"t"] == moved);
      CHECK(![ledger retireParked:@"t" generation:held]);
      CHECK([ledger parkedGeneration:@"t"] == moved);
    }
    {
      ArdiaTransferLedger *ledger = [ArdiaTransferLedger new];
      const NSInteger first = [ledger prepare:@"t"];
      CHECK([ledger isPrepared:@"t"]);
      CHECK([ledger drop:@"t"] == first);
      CHECK([ledger park:@"t"] == 0);
      CHECK([ledger parkedGeneration:@"t"] == 0);
      CHECK(![ledger retireParked:@"t" generation:first]);
    }
    {
      ArdiaTransferLedger *ledger = [ArdiaTransferLedger new];
      const NSInteger first = [ledger prepare:@"t"];
      CHECK([ledger park:@"t"] == first);
      const NSInteger second = [ledger prepare:@"t"];
      CHECK([ledger parkedGeneration:@"t"] == second);
      const NSInteger dropped = [ledger drop:@"t"];
      CHECK(dropped == second);
      CHECK(![ledger retireParked:@"t" generation:first]);
      CHECK([ledger retireParked:@"t" generation:dropped]);
      CHECK([ledger parkedGeneration:@"t"] == 0);
    }
    {
      ArdiaTransferLedger *ledger = [ArdiaTransferLedger new];
      const NSInteger first = [ledger prepare:@"t"];
      CHECK([ledger park:@"t"] == first);
      CHECK([ledger drop:@"t"] == first);
      const NSInteger second = [ledger prepare:@"t"];
      CHECK([ledger parkedGeneration:@"t"] == first);
      CHECK([ledger park:@"t"] == second);
      CHECK(![ledger retireParked:@"t" generation:first]);
      CHECK([ledger parkedGeneration:@"t"] == second);
    }
    {
      ArdiaTransferLedger *ledger = [ArdiaTransferLedger new];
      [ledger prepare:@"t"];
      [ledger park:@"t"];
      [ledger claim:@"t"];
      CHECK(![ledger isPrepared:@"t"] && [ledger parkedGeneration:@"t"] == 0);
    }
    {
      ArdiaTransferLedger *ledger = [ArdiaTransferLedger new];
      std::thread js([ledger] {
        for (int i = 0; i < 20000; i++) {
          NSString *key = i % 2 ? @"a" : @"b";
          const NSInteger generation = [ledger prepare:key];
          if (i % 3 == 0) [ledger retireParked:key generation:[ledger drop:key]];
          else if (i % 3 == 1) [ledger retireParked:key generation:generation];
        }
      });
      int expired = 0;
      for (int i = 0; i < 20000; i++) {
        NSString *key = i % 2 ? @"b" : @"a";
        const NSInteger held = [ledger holdForReload:key];
        [ledger park:key];
        if ([ledger expireReloadHold:key generation:held]) expired++;
        [ledger retireParked:key generation:held];
      }
      js.join();
      CHECK(expired > 0);
    }
  }
  if (failures) return 1;
  std::printf("transfer-ledger: ok\n");
  return 0;
}
