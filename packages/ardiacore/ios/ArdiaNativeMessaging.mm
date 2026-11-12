#import "ArdiaNativeMessaging.h"

namespace ardia_native_messaging {

namespace {

NSString *const kChromeSystemDir = @"/Library/Google/Chrome/NativeMessagingHosts";
NSString *const kManagedList = @".ardia-managed.json";

NSArray<NSDictionary *> *KnownHosts() {
  return @[
    @{
      @"name" : @"com.1password.1password",
      @"description" : @"1Password BrowserSupport",
      @"path" : @"/Applications/1Password.app/Contents/Library/LoginItems/1Password Browser Helper.app/Contents/MacOS/"
                @"1Password-BrowserSupport",
      @"type" : @"stdio",
      @"allowed_origins" : @[
        @"chrome-extension://hjlinigoblmkhjejkmbegnoaljkphmgo/",
        @"chrome-extension://gejiddohjgogedgjnonbofjigllpkmbf/",
        @"chrome-extension://khgocmkkpikpnmmkgmdnfckapcdkgfaf/",
        @"chrome-extension://aeblfdkhhhdcdjpifhhbdiojplfjncoa/",
        @"chrome-extension://dppgmdbiimibapkepcbdbmkaabgiofem/",
      ],
    },
    @{
      @"name" : @"com.8bit.bitwarden",
      @"description" : @"Bitwarden desktop <-> browser bridge",
      @"path" : @"/Applications/Bitwarden.app/Contents/MacOS/desktop_proxy",
      @"type" : @"stdio",
      @"allowed_origins" : @[
        @"chrome-extension://nngceckbapebfimnlniiiahkandclblb/",
        @"chrome-extension://hccnnhgbibccigepcmlgppchkpfdophk/",
        @"chrome-extension://jbkfoedolllekgbhcbcoahefnbanhhlh/",
        @"chrome-extension://ccnckbpmaceehanjmeomladnmlffdjgn/",
      ],
    },
    @{
      @"name" : @"org.keepassxc.keepassxc_browser",
      @"description" : @"KeePassXC integration with native messaging support",
      @"path" : @"/Applications/KeePassXC.app/Contents/MacOS/keepassxc-proxy",
      @"type" : @"stdio",
      @"allowed_origins" : @[
        @"chrome-extension://pdffhmdngciaglkoonimfcmckehcpafo/",
        @"chrome-extension://oboonakemofpalcgghocfoadofidjkkk/",
      ],
    },
    @{
      @"name" : @"me.proton.pass.nm",
      @"description" : @"Proton Pass host for native messaging with the desktop app",
      @"path" : @"/Applications/Proton Pass.app/Contents/Resources/assets/proton_pass_nm_host",
      @"type" : @"stdio",
      @"allowed_origins" : @[
        @"chrome-extension://ghmbeldphafepmbegfdlkpapadhbakde/",
        @"chrome-extension://hlaiofkbmjenhgeinjlmkafaipackfjh/",
        @"chrome-extension://gcllgfdnfnllodcaambdaknbipemelie/",
      ],
    },
  ];
}

NSString *ManifestPath(NSString *dir, NSString *name) {
  return [dir stringByAppendingPathComponent:[name stringByAppendingPathExtension:@"json"]];
}

bool IsUsable(NSDictionary *manifest, NSString *name) {
  if (![manifest isKindOfClass:NSDictionary.class]) return false;
  NSString *path = manifest[@"path"];
  return [manifest[@"name"] isEqual:name] && [manifest[@"type"] isEqual:@"stdio"] &&
         [manifest[@"allowed_origins"] isKindOfClass:NSArray.class] && [path isKindOfClass:NSString.class] &&
         path.isAbsolutePath && [NSFileManager.defaultManager isExecutableFileAtPath:path];
}

NSDictionary<NSString *, NSData *> *InstalledHosts() {
  NSMutableDictionary<NSString *, NSData *> *hosts = [NSMutableDictionary dictionary];
  for (NSDictionary *manifest in KnownHosts()) {
    NSString *name = manifest[@"name"];
    NSData *system = [NSData dataWithContentsOfFile:ManifestPath(kChromeSystemDir, name)];
    if (system && IsUsable([NSJSONSerialization JSONObjectWithData:system options:0 error:nil], name))
      hosts[name] = system;
    else if (IsUsable(manifest, name))
      hosts[name] = [NSJSONSerialization dataWithJSONObject:manifest
                                                    options:NSJSONWritingPrettyPrinted | NSJSONWritingWithoutEscapingSlashes
                                                      error:nil];
  }
  return hosts;
}

}

void SyncHosts(NSString *userDataDir) {
  NSFileManager *fm = NSFileManager.defaultManager;
  NSString *dir = [userDataDir stringByAppendingPathComponent:@"NativeMessagingHosts"];
  [fm createDirectoryAtPath:dir withIntermediateDirectories:YES attributes:nil error:nil];
  NSString *listPath = [dir stringByAppendingPathComponent:kManagedList];
  NSData *listData = [NSData dataWithContentsOfFile:listPath];
  NSArray *previous = listData ? [NSJSONSerialization JSONObjectWithData:listData options:0 error:nil] : nil;
  NSSet<NSString *> *managed = [previous isKindOfClass:NSArray.class] ? [NSSet setWithArray:previous] : [NSSet set];

  NSDictionary<NSString *, NSData *> *hosts = InstalledHosts();
  NSMutableSet<NSString *> *nowManaged = [NSMutableSet set];
  for (NSString *name in hosts) {
    NSString *path = ManifestPath(dir, name);
    bool ours = [managed containsObject:name];
    if (!ours && [fm fileExistsAtPath:path]) continue;
    if (![[NSData dataWithContentsOfFile:path] isEqualToData:hosts[name]] &&
        ![hosts[name] writeToFile:path options:NSDataWritingAtomic error:nil])
      continue;
    [nowManaged addObject:name];
  }
  for (NSString *name in managed)
    if (![nowManaged containsObject:name]) [fm removeItemAtPath:ManifestPath(dir, name) error:nil];

  if (![nowManaged isEqualToSet:managed]) {
    NSArray *names = [nowManaged.allObjects sortedArrayUsingSelector:@selector(compare:)];
    [[NSJSONSerialization dataWithJSONObject:names options:0 error:nil] writeToFile:listPath atomically:YES];
  }
}

}
