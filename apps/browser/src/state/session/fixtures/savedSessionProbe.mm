#import "ArdiaSavedSession.h"
#include <cstdio>
#include <cstdlib>

static ArdiaSavedSession *Write(NSString *dir, NSDictionary *doc) {
  [[NSFileManager defaultManager] createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
  [[NSJSONSerialization dataWithJSONObject:doc options:0 error:nil] writeToFile:[dir stringByAppendingPathComponent:@"session.json"] atomically:YES];
  return [ArdiaSavedSession readFrom:dir];
}

static void Check(BOOL ok, const char *what) {
  printf("%s %s\n", ok ? "ok" : "FAIL", what);
  if (!ok) exit(1);
}

int main(int argc, char **argv) {
  @autoreleasepool {
    NSString *root = [NSString stringWithUTF8String:argv[1]];
    NSDictionary *oldTab = @{ @"id" : @"a", @"pinned" : @YES, @"pinnedAsRow" : @YES };
    NSDictionary *newTab = @{ @"id" : @"a", @"pin" : @{ @"as" : @"row" } };
    for (NSNumber *v in @[ @4, @5 ]) {
      ArdiaSavedSession *s = Write([root stringByAppendingPathComponent:v.stringValue], @{ @"version" : v, @"tabs" : @[ oldTab ] });
      Check(s && s.fileVersion == v.integerValue && [[s pinOfTab:s.tabs[0]] isEqual:@YES], [NSString stringWithFormat:@"a version %@ file reads pinned", v].UTF8String);
    }
    ArdiaSavedSession *none = Write([root stringByAppendingPathComponent:@"0"], @{ @"tabs" : @[ oldTab ] });
    Check(none && none.fileVersion == 0 && [[none pinOfTab:none.tabs[0]] isEqual:@YES], "a file without a version reads pinned");
    ArdiaSavedSession *six = Write([root stringByAppendingPathComponent:@"6"], @{ @"version" : @6, @"tabs" : @[ newTab, @{ @"id" : @"b", @"pin" : NSNull.null } ] });
    Check(six && six.fileVersion == 6 && [[six pinOfTab:six.tabs[0]] isEqual:@{ @"as" : @"row" }], "a version 6 file reads pin");
    Check([[six pinOfTab:six.tabs[1]] isEqual:NSNull.null], "an unpinned version 6 tab reads null");
    Check(![[six pinOfTab:six.tabs[0]] isEqual:@YES] && [six pinOfTab:@{ @"pinned" : @YES }] == nil, "version 6 ignores the old field");
    NSDictionary *oldSplit = @{ @"id" : @"s", @"tabIds" : @[ @"a", @"b", @"c" ], @"sizes" : @[ @0.5, @0.5 ], @"stack" : @{ @"index" : @1 } };
    NSDictionary *newSplit = @{ @"id" : @"s", @"slots" : @[ @{ @"size" : @0.5, @"tabId" : @"a" }, @{ @"size" : @0.5, @"stack" : @[ @"b", @"c" ], @"stackSizes" : @[ @0.5, @0.5 ] } ] };
    NSArray *abc = @[ @"a", @"b", @"c" ];
    for (NSNumber *v in @[ @5, @6 ]) {
      ArdiaSavedSession *s = Write([root stringByAppendingPathComponent:[@"split" stringByAppendingString:v.stringValue]], @{ @"version" : v, @"splits" : @[ oldSplit ] });
      Check([[s tabIdsOfSplit:s.splits[0]] isEqual:abc], [NSString stringWithFormat:@"a version %@ split reads its tabIds", v].UTF8String);
    }
    ArdiaSavedSession *seven = Write([root stringByAppendingPathComponent:@"split7"], @{ @"version" : @7, @"splits" : @[ newSplit, oldSplit ] });
    Check([[seven tabIdsOfSplit:seven.splits[0]] isEqual:abc], "a version 7 split reads its slots in order, stacks included");
    Check([seven tabIdsOfSplit:seven.splits[1]].count == 0, "version 7 ignores the old tabIds");
    Check(Write([root stringByAppendingPathComponent:@"newer"], @{ @"version" : @(ArdiaSavedSession.version + 1), @"tabs" : @[] }) == nil, "a newer file is refused");
  }
  return 0;
}
