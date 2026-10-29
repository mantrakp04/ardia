#import "ArdiaLaunchConfig.h"

#import <Security/Security.h>
#import <os/log.h>

namespace {

NSString *const kDataDirVariable = @"ARDIA_DATA_DIR";
NSString *const kBackgroundVariable = @"ARDIA_BACKGROUND";
NSString *const kRemoteDebuggingPortVariable = @"ARDIA_REMOTE_DEBUGGING_PORT";
NSString *const kInstanceVariable = @"ARDIA_INSTANCE";
NSString *const kSwitchesVariable = @"ARDIA_SWITCHES";
NSString *const kTraceVariable = @"ARDIA_TRACE";
NSString *const kTestVariable = @"ARDIA_TEST";
NSString *const kPrewarmVariable = @"ARDIA_PREWARM";
NSString *const kSwitchesCacheDocument = @"switches-cache.json";

NSArray<NSString *> *InstanceKeys() {
  return @[
    @"jsLocation", @"chromiumSwitches", @"downloadsDir", @"updateFeed", @"allowAudio", @"allowOcclusion", @"releaseNotes",
    @"cliHome", @"cliBinDir", @"cliUrl", @"syncFolder", @"importSourceDir", @"importSafariHome",
  ];
}

NSArray<NSString *> *EngineInstanceKeys() {
  return @[ @"downloadsDir" ];
}

NSArray<NSString *> *EngineTestKeys() {
  return @[
    @"keychain", @"keychainHiddenReads", @"keychainFail", @"safeStorageAnswer", @"reauth", @"bluetoothChooser",
    @"externalProtocolNoLaunch", @"externalProtocolApp", @"mediaRouteProvider", @"systemMediaPermission", @"applyProfileGate", @"contextMenu",
    @"loginsDelay", @"loginsReleaseAfter",
  ];
}

NSArray<NSString *> *AppTestKeys() {
  return @[
    @"pipSelfTest", @"pipHover", @"fakeFullScreenMs", @"shadersKeyWindow", @"peekStrict", @"importSecret", @"importDiaBundleId", @"importDiaWindows",
    @"cliInstallScript", @"legacySource", @"legacyCrashAfter", @"bangsUrl", @"onboarding", @"whatsNew", @"telemetry",
    @"liveMock", @"calendarFixture", @"appMenu", @"appDialog", @"loginsTimeout",
  ];
}

NSArray<NSString *> *KeysWhoseValuesHoldCommas() {
  return @[
    @"chromiumSwitches", @"downloadsDir", @"updateFeed", @"cliHome", @"cliBinDir", @"cliUrl", @"syncFolder", @"importSourceDir",
    @"importSafariHome", @"importSecret", @"cliInstallScript", @"legacySource", @"bangsUrl", @"liveMock",
  ];
}

NSArray<NSString *> *TraceAreas() {
  return @[ @"visibility", @"pip", @"pipZoom", @"trafficLights", @"profileGate" ];
}

void Note(NSString *line) {
  os_log(OS_LOG_DEFAULT, "[ardia] %{public}@", line);
  fprintf(stderr, "[ardia] %s\n", line.UTF8String);
}

NSString *Trimmed(NSString *text) {
  return [text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceCharacterSet];
}

NSString *Present(NSString *_Nullable value) {
  return value.length ? value : nil;
}

BOOL Truthy(NSString *_Nullable value) {
  return value && ![@[ @"0", @"off", @"false" ] containsObject:value];
}

NSNumber *_Nullable OnOff(NSString *value) {
  if ([@[ @"on", @"1", @"true" ] containsObject:value]) return @YES;
  if ([@[ @"off", @"0", @"false" ] containsObject:value]) return @NO;
  return nil;
}

NSDictionary<NSString *, NSString *> *KeyedEntries(NSString *_Nullable text, NSArray<NSString *> *known, NSString *variable) {
  NSMutableDictionary<NSString *, NSString *> *entries = [NSMutableDictionary dictionary];
  if (!text.length) return entries;
  NSMutableArray<NSString *> *pieces = [NSMutableArray array];
  NSString *previousKey = nil;
  for (NSString *piece in [text componentsSeparatedByString:@","]) {
    NSString *head = Trimmed([piece componentsSeparatedByString:@"="].firstObject ?: @"");
    if (![known containsObject:head] && [KeysWhoseValuesHoldCommas() containsObject:previousKey]) {
      pieces[pieces.count - 1] = [pieces.lastObject stringByAppendingFormat:@",%@", piece];
      continue;
    }
    [pieces addObject:piece];
    previousKey = head;
  }
  for (NSString *piece in pieces) {
    const NSRange equals = [piece rangeOfString:@"="];
    NSString *key = Trimmed(equals.location == NSNotFound ? piece : [piece substringToIndex:equals.location]);
    if (!key.length) continue;
    if (![known containsObject:key]) {
      Note([NSString stringWithFormat:@"%@: unknown key %@ ignored", variable, key]);
      continue;
    }
    entries[key] = equals.location == NSNotFound ? @"1" : Trimmed([piece substringFromIndex:NSMaxRange(equals)]);
  }
  return entries;
}

NSDictionary<NSString *, NSNumber *> *SwitchEntries(NSString *_Nullable text) {
  NSMutableDictionary<NSString *, NSNumber *> *entries = [NSMutableDictionary dictionary];
  for (NSString *piece in [text ?: @"" componentsSeparatedByString:@","]) {
    NSArray<NSString *> *pair = [piece componentsSeparatedByString:@"="];
    if (pair.count != 2) continue;
    NSString *name = Trimmed(pair[0]);
    NSNumber *value = OnOff(Trimmed(pair[1]));
    if (name.length && value) entries[name] = value;
  }
  return entries;
}

NSSet<NSString *> *AreaEntries(NSString *_Nullable text) {
  NSMutableSet<NSString *> *areas = [NSMutableSet set];
  for (NSString *piece in [text ?: @"" componentsSeparatedByString:@","]) {
    NSString *area = Trimmed(piece);
    if (!area.length) continue;
    if (![TraceAreas() containsObject:area]) Note([NSString stringWithFormat:@"%@: unknown area %@ ignored", kTraceVariable, area]);
    else [areas addObject:area];
  }
  return areas;
}

NSString *_Nullable StandardizedDirectory(NSString *_Nullable path) {
  if (!path.length) return nil;
  if (!path.absolutePath) path = [NSFileManager.defaultManager.currentDirectoryPath stringByAppendingPathComponent:path];
  return path.stringByStandardizingPath;
}

BOOL BackgroundValue(NSString *_Nullable value) {
  return value.length && ![value isEqualToString:@"0"];
}

NSString *Kebab(NSString *key) {
  NSMutableString *kebab = [NSMutableString string];
  for (NSUInteger i = 0; i < key.length; i++) {
    const unichar c = [key characterAtIndex:i];
    if (c >= 'A' && c <= 'Z') [kebab appendFormat:@"-%C", (unichar)(c - 'A' + 'a')];
    else [kebab appendFormat:@"%C", c];
  }
  return kebab;
}

NSString *Joined(NSDictionary<NSString *, NSString *> *entries, NSArray<NSString *> *keys) {
  NSMutableArray<NSString *> *parts = [NSMutableArray array];
  for (NSString *key in keys)
    if (NSString *value = entries[key]) [parts addObject:[value isEqualToString:@"1"] ? key : [NSString stringWithFormat:@"%@=%@", key, value]];
  return [parts componentsJoinedByString:@","];
}

BOOL SignedForDistribution() {
  SecCodeRef code = nullptr;
  if (SecCodeCopySelf(kSecCSDefaultFlags, &code) != errSecSuccess) return YES;
  SecRequirementRef requirement = nullptr;
  const OSStatus made = SecRequirementCreateWithString(
      CFSTR("anchor apple generic and "
            "(certificate leaf[field.1.2.840.113635.100.6.1.9] exists or "
            "certificate 1[field.1.2.840.113635.100.6.2.6] exists and "
            "certificate leaf[field.1.2.840.113635.100.6.1.13] exists)"),
      kSecCSDefaultFlags, &requirement);
  if (made != errSecSuccess) {
    CFRelease(code);
    return YES;
  }
  const BOOL distribution = SecCodeCheckValidity(code, kSecCSDefaultFlags, requirement) == errSecSuccess;
  CFRelease(requirement);
  CFRelease(code);
  return distribution;
}

}

@implementation ArdiaLaunchConfig {
  NSDictionary<NSString *, NSString *> *_instance;
  NSDictionary<NSString *, NSNumber *> *_switches;
  NSDictionary<NSString *, NSNumber *> *_cachedSwitches;
  NSSet<NSString *> *_requestedAreas;
  NSDictionary<NSString *, NSString *> *_requestedTest;
  BOOL (^_signedForDistribution)(void);
  NSNumber *_testInstance;
  NSDictionary<NSString *, NSString *> *_environmentForChildProcesses;
}

+ (ArdiaLaunchConfig *)shared {
  static ArdiaLaunchConfig *shared;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    shared = [[ArdiaLaunchConfig alloc] initWithEnvironment:NSProcessInfo.processInfo.environment
                                      signedForDistribution:^BOOL { return SignedForDistribution(); }];
  });
  return shared;
}

- (instancetype)initWithEnvironment:(NSDictionary<NSString *, NSString *> *)environment
              signedForDistribution:(BOOL (^)(void))signedForDistribution {
  if ((self = [super init])) {
    _dataDirectory = StandardizedDirectory(environment[kDataDirVariable]);
    _background = BackgroundValue(environment[kBackgroundVariable]);
    const NSInteger port = Trimmed(environment[kRemoteDebuggingPortVariable] ?: @"").integerValue;
    _remoteDebuggingPort = port > 0 && port < 65536 ? @(port) : nil;
    _prewarm = Present(environment[kPrewarmVariable]) != nil;
    _instance = KeyedEntries(environment[kInstanceVariable], InstanceKeys(), kInstanceVariable);
    _switches = SwitchEntries(environment[kSwitchesVariable]);
    _requestedAreas = AreaEntries(environment[kTraceVariable]);
    _requestedTest = KeyedEntries(environment[kTestVariable], [EngineTestKeys() arrayByAddingObjectsFromArray:AppTestKeys()], kTestVariable);
    _signedForDistribution = [signedForDistribution copy];
    NSMutableDictionary<NSString *, NSString *> *inherited = [NSMutableDictionary dictionary];
    [environment enumerateKeysAndObjectsUsingBlock:^(NSString *name, NSString *value, BOOL *) {
      if (![name hasPrefix:@"ARDIA_"]) inherited[name] = value;
    }];
    _environmentForChildProcesses = inherited;
    if ((_requestedAreas.count || _requestedTest.count) && !self.testInstance)
      Note([NSString stringWithFormat:@"%@ and %@ ignored: not a test instance (%@)", kTestVariable, kTraceVariable,
                                      _dataDirectory ? @"signed for distribution" : @"no scratch ARDIA_DATA_DIR"]);
  }
  return self;
}

- (BOOL)isolated {
  return _dataDirectory != nil;
}

- (BOOL)testInstance {
  @synchronized(self) {
    if (!_testInstance) _testInstance = @(_dataDirectory != nil && !_signedForDistribution());
    return _testInstance.boolValue;
  }
}

- (NSString *)instance:(NSString *)key {
  return Present(_instance[key]);
}

- (BOOL)instanceFlag:(NSString *)key {
  return Truthy([self instance:key]);
}

- (NSNumber *)switchOverride:(NSString *)name {
  return _switches[name];
}

- (NSDictionary<NSString *, NSNumber *> *)cachedSwitches {
  @synchronized(self) {
    if (!_cachedSwitches) _cachedSwitches = [self readCachedSwitches];
    return _cachedSwitches;
  }
}

- (NSDictionary<NSString *, NSNumber *> *)readCachedSwitches {
  NSString *directory = _dataDirectory;
  if (!directory) {
    NSString *support = NSSearchPathForDirectoriesInDomains(NSApplicationSupportDirectory, NSUserDomainMask, YES).firstObject;
    directory = [support stringByAppendingPathComponent:NSBundle.mainBundle.bundleIdentifier ?: @"com.ardia.browser"];
  }
  NSData *data = [NSData dataWithContentsOfFile:[directory stringByAppendingPathComponent:kSwitchesCacheDocument]];
  NSDictionary *cache = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  NSDictionary *saved = [cache isKindOfClass:NSDictionary.class] && [cache[@"switches"] isKindOfClass:NSDictionary.class] ? cache[@"switches"] : @{};
  NSMutableDictionary<NSString *, NSNumber *> *switches = [NSMutableDictionary dictionary];
  [saved enumerateKeysAndObjectsUsingBlock:^(id name, id value, BOOL *) {
    if ([name isKindOfClass:NSString.class] && [value isKindOfClass:NSNumber.class] && CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID())
      switches[name] = value;
  }];
  return [switches copy];
}

- (BOOL)switchOn:(NSString *)name {
  if (NSNumber *said = _switches[name]) return said.boolValue;
  if (NSNumber *cached = self.cachedSwitches[name]) return cached.boolValue;
  return YES;
}

- (BOOL)experimentOn:(NSString *)name {
  return _switches[name].boolValue;
}

- (BOOL)traced:(NSString *)area {
  return [_requestedAreas containsObject:area] && self.testInstance;
}

- (NSString *)testValue:(NSString *)key {
  NSString *value = _requestedTest[key];
  return value && self.testInstance ? value : nil;
}

- (BOOL)testFlag:(NSString *)key {
  return Truthy([self testValue:key]);
}

- (NSDictionary<NSString *, NSString *> *)honouredTest {
  return self.testInstance ? _requestedTest : @{};
}

- (NSSet<NSString *> *)honouredAreas {
  return self.testInstance ? _requestedAreas : [NSSet set];
}

- (NSArray<NSString *> *)engineSwitches {
  NSMutableArray<NSString *> *switches = [NSMutableArray array];
  if (_background) [switches addObject:@"--ardia-background"];
  if (_dataDirectory) [switches addObject:[@"--ardia-data-dir=" stringByAppendingString:_dataDirectory]];
  for (NSString *key in EngineInstanceKeys())
    if (NSString *value = [self instance:key]) [switches addObject:[NSString stringWithFormat:@"--ardia-%@=%@", Kebab(key), value]];
  if (_switches.count) {
    NSMutableArray<NSString *> *parts = [NSMutableArray array];
    for (NSString *name in [_switches.allKeys sortedArrayUsingSelector:@selector(compare:)])
      [parts addObject:[NSString stringWithFormat:@"%@=%@", name, _switches[name].boolValue ? @"on" : @"off"]];
    [switches addObject:[@"--ardia-switches=" stringByAppendingString:[parts componentsJoinedByString:@","]]];
  }
  NSString *test = Joined(self.honouredTest, EngineTestKeys());
  if (test.length) [switches addObject:[@"--ardia-test=" stringByAppendingString:test]];
  NSArray<NSString *> *areas = [self.honouredAreas.allObjects sortedArrayUsingSelector:@selector(compare:)];
  if (areas.count) [switches addObject:[@"--ardia-trace=" stringByAppendingString:[areas componentsJoinedByString:@","]]];
  return switches;
}

- (NSDictionary<NSString *, id> *)snapshot {
  NSMutableDictionary<NSString *, id> *switches = [NSMutableDictionary dictionary];
  [_switches enumerateKeysAndObjectsUsingBlock:^(NSString *name, NSNumber *on, BOOL *) { switches[name] = on; }];
  return @{
    @"dataDirectory" : _dataDirectory ?: NSNull.null,
    @"background" : @(_background),
    @"isolated" : @(self.isolated),
    @"testInstance" : @(self.testInstance),
    @"instance" : _instance,
    @"switches" : switches,
    @"trace" : [self.honouredAreas.allObjects sortedArrayUsingSelector:@selector(compare:)],
    @"test" : self.honouredTest,
  };
}

@end
